// Idle-gated single-flight scheduler (GEN-01, QUEUE-02). Takes `bridge`, `store`, `generate`,
// and `append` as injected parameters so it is unit-testable against a fake bridge without a
// live ST instance (D-10). This module never calls two generate()s concurrently and never
// recurses to retry — every wait is driven by setTimeout polling so the call stack does not
// grow unbounded on a long-paused queue.

import { fingerprintMatches } from './fingerprint.js';

const APPEND_RETRY_MS = 250;
const IDLE_RETRY_MS = 250;

function isIdle(bridge) {
  return !bridge.isGenerating() && bridge.swipeState() === 'none';
}

function extractReason(err) {
  if (err && typeof err === 'object') {
    if (typeof err.error === 'string') return err.error;
    if (typeof err.reason === 'string') return err.reason;
    if (typeof err.message === 'string') return err.message;
  }
  return 'error';
}

export function createRunner({ bridge, store, generate, append }) {
  let running = false;
  let paused = false;
  let idleRetryTimer = null;
  const failedListeners = new Set();

  function notifyFailed(id, reason) {
    // A stale drop (fingerprint mismatch at either GUARD-04 checkpoint) is a silent
    // target-safety discard, not a user-facing failure — GUARD-05's toast taxonomy only
    // covers api/empty/cancelled, so firing a toast for every stale drop would be noise
    // unrelated to anything the user did wrong.
    if (reason === 'stale') return;
    for (const cb of failedListeners) cb({ id, reason });
  }

  function scheduleIdleRetry() {
    if (idleRetryTimer) return;
    idleRetryTimer = setTimeout(() => {
      idleRetryTimer = null;
      wake();
    }, IDLE_RETRY_MS);
  }

  async function flushAppend(mesId, text, meta) {
    // Park-then-flush: keep retrying the append on a short poll until ST goes idle again
    // (SWIPE-04), rather than dropping the item just because ST was briefly busy.
    while (true) {
      const outcome = await append(mesId, text, meta);
      if (outcome === 'defer') {
        await new Promise((resolve) => setTimeout(resolve, APPEND_RETRY_MS));
        continue;
      }
      return outcome; // 'ok' or 'stale'
    }
  }

  async function processNext() {
    const item = store.peekNext();
    if (!item) return false;

    if (!fingerprintMatches(bridge, item.fingerprint)) {
      store.drop(item.id, 'stale');
      notifyFailed(item.id, 'stale');
      return true;
    }

    store.markRunning(item.id);

    let result;
    try {
      result = await generate(item);
    } catch (err) {
      const reason = extractReason(err);
      store.drop(item.id, reason);
      notifyFailed(item.id, reason);
      return true;
    }

    if (result && typeof result === 'object' && 'error' in result) {
      const reason = extractReason(result);
      store.drop(item.id, reason);
      notifyFailed(item.id, reason);
      return true;
    }

    // GUARD-04's second checkpoint: re-validate the target independently, immediately before
    // the append, since an edit/delete/chat-switch may have landed in the window while
    // generate() was running. The generated text is discarded here and never appended anywhere.
    if (!fingerprintMatches(bridge, item.fingerprint)) {
      store.drop(item.id, 'stale');
      notifyFailed(item.id, 'stale');
      return true;
    }

    const mesId = item.fingerprint.mesId;
    let appended;
    try {
      appended = await flushAppend(mesId, result.text, result.meta);
    } catch (err) {
      const reason = extractReason(err);
      store.drop(item.id, reason);
      notifyFailed(item.id, reason);
      return true;
    }
    if (appended === 'ok') {
      store.markDone(item.id);
    } else if (appended === 'stale') {
      // Target changed while this item was generating; the generated text is discarded here
      // and is never retried or appended elsewhere.
      store.drop(item.id, 'stale');
      notifyFailed(item.id, 'stale');
    }
    return true;
  }

  async function loop() {
    while (true) {
      if (paused) return;
      if (!isIdle(bridge)) {
        scheduleIdleRetry();
        return;
      }
      const hadItem = await processNext();
      if (!hadItem) return;
    }
  }

  /**
   * Wake the runner to process queued items. A second wake() fired while one item is already
   * running (or while waiting for idle/append-retry) is a no-op — the active loop will pick up
   * any newly enqueued item on its next iteration once it is free to do so. While paused, wake()
   * is also a no-op even if items are pending (GEN-01's "no overlap with native generation").
   */
  async function wake() {
    if (paused) return;
    if (running) return;
    running = true;
    try {
      await loop();
    } finally {
      running = false;
    }
  }

  /**
   * Pause the runner: wake() becomes a no-op (does not start a new item) until resume() is
   * called, even if items are pending. Does not abort an item already mid-generate() — the
   * Guard only blocks the *next* item from starting, it never interrupts a running one.
   */
  function pause(reason) {
    paused = true;
  }

  /** Clear the paused flag and kick the runner once. Returns wake()'s promise. */
  function resume() {
    paused = false;
    return wake();
  }

  function onItemFailed(cb) {
    failedListeners.add(cb);
  }

  function offItemFailed(cb) {
    failedListeners.delete(cb);
  }

  return { wake, pause, resume, onItemFailed, offItemFailed };
}
