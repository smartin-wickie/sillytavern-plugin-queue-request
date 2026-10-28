// Lifecycle policy: decides when ST message events invalidate the queued swipes, and how a
// native Continue keeps them alive. Pure module (injected bridge/store/runner/toast) so it is
// unit-testable without a live ST instance.
import { buildFingerprint, fingerprintStatus } from './fingerprint.js';
import { loadStored } from './persistence.js';
import { diffConnection } from './connection.js';

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
const READONLY_TOAST = "This chat's queue is managed in another tab. Showing it read-only here.";
const TAKEOVER_TOAST = 'This tab now manages the queue. It is paused; resume from the queue badge.';

export function createLifecycle({
  bridge,
  store,
  runner,
  toast,
  moduleName = 'queuedSwipes',
  promptResume,
  popups,
  ownership,
}) {
  const handlers = [];
  let continueTarget = null;
  const state = { boundKey: null, boundIntegrity: null };
  let loadToken = 0;
  let initialized = false;
  let connectionPopupOpen = false;

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

  // Chat switch / load. The synchronous prefix pauses the runner first so no loop iteration can
  // start the new chat's items, drops per-chat pause reasons (the 'inspector' reason tracks the
  // live Prompt Inspector state and is left alone), aborts the running item back to the queue
  // without a failure report, and detaches the store from the old chat so nothing is ever
  // written into the new one. CHAT_CHANGED also fires on same-chat reloads, so an identical
  // key and integrity is a no-op beyond a safe persist.
  function handleChatChanged() {
    const c = bridge.ctx();
    const key = bridge.chatKey?.(c) ?? null;
    const integrity = c.chatMetadata?.integrity ?? null;
    if (initialized && key === state.boundKey && integrity === state.boundIntegrity) {
      if (key !== null) store.persist();
      return;
    }

    initialized = true;
    const token = ++loadToken;
    runner.pause('restored');
    for (const r of ['failures', 'connection', 'takeover']) runner.resume(r);
    runner.invalidate();
    runner.resetCounters?.();
    runner.abortRunning({ disposition: 'requeue' });
    store.unbind();
    store.rebind([]);
    state.boundKey = null;
    state.boundIntegrity = null;
    if (ownership) {
      // Closes the claim window: while unbound and unclaimed nothing may be enqueued or
      // persisted, so a later rebind cannot overwrite an enqueue.
      store.setReadOnly(true);
      ownership.release();
    }

    schedule(() => {
      if (token !== loadToken) return;
      const live = bridge.ctx();
      const liveKey = bridge.chatKey?.(live) ?? null;
      if (liveKey === null) {
        state.boundKey = null;
        state.boundIntegrity = null;
        if (ownership) store.setReadOnly(false);
        runner.resume('restored');
        return;
      }
      if (!ownership) {
        loadChat(token);
        return;
      }
      Promise.resolve(ownership.claim(liveKey)).then((result) => {
        if (token !== loadToken) return;
        if (result?.role === 'readonly') {
          // Another tab owns this chat: stay inert and paused, no load and no popup.
          state.boundKey = liveKey;
          state.boundIntegrity = live.chatMetadata?.integrity ?? null;
          store.setReadOnly(true);
          toast(READONLY_TOAST);
          return;
        }
        store.setReadOnly(false);
        loadChat(token);
      });
    });
  }

  // Binds the store to the live chat, loads the saved queue and offers the resume prompt.
  function loadChat(token) {
    const live = bridge.ctx();
    const liveKey = bridge.chatKey?.(live) ?? null;
    if (liveKey === null) {
      runner.resume('restored');
      return;
    }
    const liveIntegrity = live.chatMetadata?.integrity ?? null;
    state.boundKey = liveKey;
    state.boundIntegrity = liveIntegrity;
    store.bindChat(liveKey, liveIntegrity);
    const result = loadStored(live.chatMetadata?.[moduleName], live, Date.now(), { maxItems: 20 });
    store.rebind(result.items);
    if (result.dropped > 0) {
      toast(`Dropped ${result.dropped} saved queued swipe(s): the message changed or they expired.`);
      store.persist({ immediate: true });
    }
    if (result.items.length === 0) {
      runner.resume('restored');
      return;
    }
    const prompt = popups?.showResume ? (info) => runResumePrompt(info, token, liveKey) : promptResume;
    if (typeof prompt === 'function') {
      schedule(() => {
        if (token === loadToken) prompt({ count: result.items.length, items: result.items });
      });
    }
  }

  // Ownership role changes. Takeover always lands paused with no popup and no auto-run;
  // demotion makes this tab inert (no failure toast, no writes).
  function onRoleChange({ role, reason } = {}) {
    if (role === 'readonly') {
      runner.invalidate();
      runner.abortRunning({ disposition: 'discard' });
      store.setReadOnly(true);
      return;
    }
    if (role !== 'owner' || reason !== 'takeover') return;
    if (state.boundKey === null) return;
    const c = bridge.ctx();
    if ((bridge.chatKey?.(c) ?? null) !== state.boundKey) return;
    const integrity = c.chatMetadata?.integrity ?? null;
    state.boundIntegrity = integrity;
    store.setReadOnly(false);
    store.bindChat(state.boundKey, integrity);
    // Prefer the previous owner's snapshot; a missing or unusable one (wrong version, bad
    // shape) falls back to chat metadata instead of silently restoring nothing.
    const snapshot = ownership?.readState?.()?.snapshot;
    let result = snapshot ? loadStored(snapshot, c, Date.now(), { maxItems: 20 }) : null;
    if (!result || result.ignored) {
      result = loadStored(c.chatMetadata?.[moduleName], c, Date.now(), { maxItems: 20 });
    }
    store.rebind(result.items);
    if (result.dropped > 0) store.persist({ immediate: true });
    if (result.items.length > 0) {
      // Pause before releasing the load hold so the runner cannot start an item in between.
      runner.pause('takeover');
      runner.resume('restored');
      toast(TAKEOVER_TOAST);
    } else {
      runner.resume('restored');
    }
  }

  // Resume prompt: deferred while a native generation runs, silent if the chat changed in the
  // meantime. The popup is awaited here, in a scheduled task, never inside an event handler.
  async function runResumePrompt({ count, items }, token, key) {
    if (token !== loadToken) return;
    if (bridge.isGenerating?.()) {
      setTimeout(() => runResumePrompt({ count, items }, token, key), 500);
      return;
    }
    if ((bridge.chatKey?.(bridge.ctx()) ?? null) !== key) return;
    if (store.isReadOnly?.()) return;
    const first = items[0]?.connection ?? null;
    const payload = { count, model: first?.model ?? null, api: first?.api ?? null };
    const current = bridge.connectionSnapshot?.() ?? null;
    const mismatch = first && current && diffConnection(first, current).length > 0;
    if (mismatch) payload.connectionNote = { model: current.model ?? null, api: current.api ?? null };
    const answer = await popups.showResume(payload);
    if (token !== loadToken) return;
    if (answer === 'resume') {
      // Resume queue counts as consent to the current connection.
      if (mismatch) store.setConnectionAll(current);
      runner.resume('restored');
    } else if (answer === 'discard') {
      const n = store.clear('discarded');
      toast(`Discarded ${n > 0 ? n : count} queued swipe(s).`);
      runner.resume('restored');
    }
  }

  // Connection gate fired by the runner: ask whether to continue on the new connection. Runs
  // in a scheduled task, never inside an event handler, and never stacks two popups.
  function onConnectionChanged(info) {
    const key = bridge.chatKey?.(bridge.ctx()) ?? null;
    schedule(() => runConnectionPrompt(info, key));
  }

  async function runConnectionPrompt({ changed, old, current }, key) {
    if (connectionPopupOpen || !popups?.showConnection) return;
    if (store.isReadOnly?.()) return;
    if ((bridge.chatKey?.(bridge.ctx()) ?? null) !== key) return;
    connectionPopupOpen = true;
    let answer;
    try {
      answer = await popups.showConnection({ changed, old, current });
    } finally {
      connectionPopupOpen = false;
    }
    if ((bridge.chatKey?.(bridge.ctx()) ?? null) !== key) return;
    if (answer === 'continue') {
      store.setConnectionAll(bridge.connectionSnapshot?.() ?? current);
      runner.resume('connection');
    }
  }

  const HANDLER_MAP = {
    MESSAGE_EDITED: (...args) => schedule(() => onEdited(...args)),
    MESSAGE_DELETED: (...args) => schedule(() => onDeleted(...args)),
    MESSAGE_SENT: (...args) => schedule(() => onSent(...args)),
    MESSAGE_RECEIVED: (...args) => schedule(() => onReceived(...args)),
  };

  function start() {
    runner.onConnectionChanged?.(onConnectionChanged);
    ownership?.onRoleChange(onRoleChange);
    for (const key of WATCHED_EVENTS) {
      const evt = bridge.event_types[key];
      if (!evt) continue;
      const h = HANDLER_MAP[key];
      bridge.eventSource.on(evt, h);
      handlers.push([evt, h]);
    }
    const changed = bridge.event_types.CHAT_CHANGED;
    if (changed) {
      bridge.eventSource.on(changed, handleChatChanged);
      handlers.push([changed, handleChatChanged]);
    }
  }

  function stop() {
    runner.offConnectionChanged?.(onConnectionChanged);
    ownership?.offRoleChange(onRoleChange);
    for (const [evt, h] of handlers.splice(0, handlers.length)) {
      bridge.eventSource.removeListener(evt, h);
    }
  }

  return { start, stop, onNativeStart, onNativeEnd, handleChatChanged };
}
