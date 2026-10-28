// Shared cancel-all implementation (D-03, QUEUE-06/07). The one place every cancel-all surface
// in this phase (badge dropdown, wand menu, /queuecancel, progress-bar stop) calls — reuses
// store.drop()/runner.abortRunning() with no new store API, per 03-RESEARCH.md Pattern 2.
import { buildFingerprint } from './fingerprint.js';

const INSPECTOR_REFUSE_TEXT = "Can't start the queue while Prompt Inspector is on. Turn it off, then try again.";

// Injected once at init (and by tests): the ST bridge and the toast functions. Kept out of the
// import graph so this module stays unit-testable without a live ST.
let configured = { bridge: null, toast: null };

export function configureQueueActions({ bridge, toast }) {
  configured = { bridge, toast };
}

/**
 * The single add path shared by the control, wand entry and /queueswipe. Refuses (with a toast)
 * while Prompt Inspector is on; otherwise adds up to `count` items for the latest message under
 * one fingerprint, bounded by the queue's remaining room, and wakes the runner once.
 */
export function enqueue(store, runner, count = 1) {
  const { bridge, toast } = configured;
  if (bridge?.promptInspectorEnabled?.()) {
    toast?.warning?.(INSPECTOR_REFUSE_TEXT);
    return { added: 0, requested: count, refused: 'inspector' };
  }
  const room = Math.max(0, store.getMaxQueueSize() - (store.pendingCount() + store.runningCount()));
  const toAdd = Math.min(count, room);
  let added = 0;
  if (toAdd > 0) {
    const c = bridge.ctx();
    const target = buildFingerprint(c, c.chat.length - 1);
    for (let i = 0; i < toAdd; i++) {
      const result = store.add(target);
      if (!result.ok) break;
      added++;
    }
  }
  if (added > 0) runner.wake();
  return { added, requested: count, refused: null };
}

/**
 * Drop every pending ('queued') item with reason 'cancelled', then abort the currently-running
 * item (if any) via runner.abortRunning(). Returns the total number of items cancelled —
 * pending items dropped here, plus 1 if a running item was actually aborted.
 */
export function cancelAll(store, runner) {
  const pending = store.getItems().filter((i) => i.status === 'queued');
  for (const item of pending) store.drop(item.id, 'cancelled');
  const { aborted } = runner.abortRunning();
  return pending.length + (aborted ? 1 : 0);
}

/**
 * The single Resume entry point shared by the dropdown and the progress bar. Clears every pause
 * reason on the runner and returns its wake promise. Refuses while Prompt Inspector is on.
 */
export function resumeQueue(store, runner) {
  if (configured.bridge?.promptInspectorEnabled?.()) {
    configured.toast?.warning?.(INSPECTOR_REFUSE_TEXT);
    return undefined;
  }
  return runner.resumeAll();
}
