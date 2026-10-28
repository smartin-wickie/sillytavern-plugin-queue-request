// Lifecycle policy: decides when ST message events invalidate the queued swipes, and how a
// native Continue keeps them alive. Pure module (injected bridge/store/runner/toast) so it is
// unit-testable without a live ST instance.
import { buildFingerprint, fingerprintStatus } from './fingerprint.js';

const WATCHED_EVENTS = ['MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED'];

const MESSAGES = {
  edited: (n) => `Cleared ${n} queued swipe(s): the message was edited.`,
  deleted: (n) => `Cleared ${n} queued swipe(s): the message was deleted.`,
  sent: (n) => `Cleared ${n} queued swipe(s): a new message was sent.`,
};

/**
 * Create the lifecycle policy. `bridge` exposes `eventSource`/`event_types`/`ctx()`; `store`
 * exposes `getItems`/`clear`/`refingerprintAll`; `runner` exposes `invalidate`/`abortRunning`;
 * `toast(message)` shows a notification.
 */
export function createLifecycle({ bridge, store, runner, toast }) {
  const handlers = [];
  let continueTarget = null;

  function schedule(fn) {
    setTimeout(fn, 0);
  }

  function activeItems() {
    return store.getItems().filter((item) => item.status === 'queued' || item.status === 'running');
  }

  function clearQueue(reason) {
    runner.invalidate();
    const n = store.clear(reason);
    runner.abortRunning({ disposition: 'discard' });
    if (n > 0) toast(MESSAGES[reason](n));
  }

  function onEdited(mesId) {
    const active = activeItems();
    if (active.length === 0) return;
    if (mesId !== active[0].fingerprint?.mesId) return;
    clearQueue('edited');
  }

  function onDeleted() {
    const active = activeItems();
    if (active.length === 0) return;
    if (fingerprintStatus(bridge, active[0].fingerprint) !== 'target') return;
    clearQueue('deleted');
  }

  function onSent() {
    if (activeItems().length === 0) return;
    clearQueue('sent');
  }

  // An empty-textarea send appends an AI message without MESSAGE_SENT; a native swipe or
  // Continue is not a new message and never clears.
  function onReceived(mesId, type) {
    const active = activeItems();
    if (active.length === 0) return;
    if (type === 'swipe' || type === 'continue') return;
    if (!(mesId > active[0].fingerprint?.mesId)) return;
    clearQueue('sent');
  }

  function onNativeStart(type) {
    if (type !== 'continue') return;
    const ctx = bridge.ctx();
    continueTarget = {
      chatId: ctx.chatId ?? null,
      integrity: ctx.chatMetadata?.integrity ?? null,
      chatLength: ctx.chat.length,
      mesId: ctx.chat.length - 1,
    };
  }

  function onNativeEnd() {
    const target = continueTarget;
    continueTarget = null;
    if (!target) return;
    const ctx = bridge.ctx();
    if ((ctx.chatId ?? null) !== target.chatId) return;
    if ((ctx.chatMetadata?.integrity ?? null) !== target.integrity) return;
    if (ctx.chat.length !== target.chatLength) return;
    if (target.mesId !== ctx.chat.length - 1 || target.mesId < 0) return;
    store.refingerprintAll(buildFingerprint(ctx, target.mesId));
  }

  const HANDLER_MAP = {
    MESSAGE_EDITED: (...args) => schedule(() => onEdited(...args)),
    MESSAGE_DELETED: (...args) => schedule(() => onDeleted(...args)),
    MESSAGE_SENT: (...args) => schedule(() => onSent(...args)),
    MESSAGE_RECEIVED: (...args) => schedule(() => onReceived(...args)),
  };

  function start() {
    for (const key of WATCHED_EVENTS) {
      const evt = bridge.event_types[key];
      if (!evt) continue;
      const h = HANDLER_MAP[key];
      bridge.eventSource.on(evt, h);
      handlers.push([evt, h]);
    }
  }

  function stop() {
    for (const [evt, h] of handlers.splice(0, handlers.length)) {
      bridge.eventSource.removeListener(evt, h);
    }
  }

  return { start, stop, onNativeStart, onNativeEnd };
}
