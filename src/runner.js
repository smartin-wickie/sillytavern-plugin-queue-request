// Idle-gated single-flight scheduler (GEN-01, QUEUE-02). Takes `bridge`, `store`, `generate`,
// and `append` as injected parameters so it is unit-testable against a fake bridge without a
// live ST instance (D-10). This module never calls two generate()s concurrently and never
// recurses to retry — every wait is driven by setTimeout polling so the call stack does not
// grow unbounded on a long-paused queue.

import { fingerprintStatus } from './fingerprint.js';
import { abortOwn } from './adapter.js';

const APPEND_RETRY_MS = 250;
const IDLE_RETRY_MS = 250;
const PAUSE_PRIORITY = ['takeover', 'restored', 'inspector', 'connection', 'failures', 'native'];

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

const DEFAULT_THRESHOLD = 3;

// Clamp the live-read breaker threshold to an integer 1..10; anything non-finite falls back to
// the default so a bad settings value can never disable the breaker.
function effectiveThreshold(getThreshold) {
  let raw;
  try {
    raw = Number(getThreshold());
  } catch {
    raw = NaN;
  }
  if (!Number.isFinite(raw)) return DEFAULT_THRESHOLD;
  return Math.min(10, Math.max(1, Math.trunc(raw)));
}

export function createRunner({ bridge, store, generate, append, getThreshold = () => DEFAULT_THRESHOLD }) {
  let running = false;
  const pauseReasons = new Set();
  const stateListeners = new Set();
  let epoch = 0;
  let abortDisposition = null;
  let idleRetryTimer = null;
  let runningController = null;
  const failedListeners = new Set();
  const doneListeners = new Set();
  const breakerListeners = new Set();
  const inspectorListeners = new Set();
  let consecutive = 0;

  function notifyFailed(id, reason) {
    // A stale drop (fingerprint mismatch at either GUARD-04 checkpoint) is a silent
    // target-safety discard, not a user-facing failure — GUARD-05's toast taxonomy only
    // covers api/empty/cancelled, so firing a toast for every stale drop would be noise
    // unrelated to anything the user did wrong.
    if (reason === 'stale') return;
    for (const cb of failedListeners) cb({ id, reason });
  }

  function notifyDone(id) {
    for (const cb of doneListeners) cb({ id });
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

  function emitState() {
    for (const cb of stateListeners) cb();
  }

  async function processNext() {
    const item = store.peekNext();
    if (!item) return false;

    const status = fingerprintStatus(bridge, item.fingerprint);
    if (status === 'chat') {
      // A chat switch is in progress: leave every item untouched and hold the queue.
      pause('restored');
      return true;
    }
    if (status === 'target') {
      store.drop(item.id, 'stale');
      notifyFailed(item.id, 'stale');
      return true;
    }

    // Prompt Inspector skips the dry run the capture relies on, so hold the queue (never abort
    // an in-flight item: this gate only runs between items).
    if (bridge.promptInspectorEnabled?.()) {
      const newlyPaused = !pauseReasons.has('inspector');
      pause('inspector');
      if (newlyPaused) for (const cb of inspectorListeners) cb();
      return true;
    }

    // --- additional start gates (owner, connection) are checked here ---

    store.markRunning(item.id);

    const myEpoch = epoch;
    let result;
    runningController = new AbortController();
    try {
      result = await generate(item, { signal: runningController.signal });
    } catch (err) {
      const reason = extractReason(err);
      return handleFailure(item, reason);
    } finally {
      runningController = null;
    }

    if (result && typeof result === 'object' && 'error' in result) {
      return handleFailure(item, extractReason(result));
    }
    abortDisposition = null;

    // Park the finished result until ST is idle and no native generation holds the queue.
    // The 'native' reason is only cleared after the guard re-fingerprints (Continue edits the
    // target), so waiting on it here keeps a paid-for result from being dropped early.
    while (!isIdle(bridge) || pauseReasons.has('native')) {
      await new Promise((resolve) => setTimeout(resolve, IDLE_RETRY_MS));
    }

    if (myEpoch !== epoch) {
      discardSilently(item);
      return true;
    }

    // GUARD-04's second checkpoint: re-validate the live target right before the append.
    if (fingerprintStatus(bridge, item.fingerprint) !== 'ok') {
      store.drop(item.id, 'stale');
      notifyFailed(item.id, 'stale');
      return true;
    }

    const mesId = item.fingerprint.mesId;
    let appended;
    try {
      // The appender's saveChat then persists the queue without this item in the same write.
      store.persistExcluding?.(item.id);
      appended = await flushAppend(mesId, result.text, result.meta);
    } catch (err) {
      const reason = extractReason(err);
      notifyFailed(item.id, reason);
      store.drop(item.id, reason);
      return true;
    }
    if (appended === 'ok') {
      // notifyDone() fires before store.markDone(): the latter's store.onChange triggers
      // ui.js's run-boundary drain detection synchronously, and for the LAST item in a run
      // that detection fires flush() in this same call stack — so the toast-coalescing
      // accumulator's recordDone() must have already run, or the drain's `completed` count
      // undercounts the very item that just finished (confirmed live, off-by-one, ST 1.19.0).
      consecutive = 0;
      notifyDone(item.id);
      store.markDone(item.id);
    } else if (appended === 'stale') {
      // Target changed while this item was generating; the generated text is discarded here
      // and is never retried or appended elsewhere.
      store.drop(item.id, 'stale');
      notifyFailed(item.id, 'stale');
    }
    return true;
  }

  function discardSilently(item) {
    const current = store.getItems().find((i) => i.id === item.id);
    if (current && current.status === 'running') store.drop(item.id, 'stale');
  }

  // Returns whether the loop should keep going.
  function handleFailure(item, reason) {
    const disposition = abortDisposition;
    abortDisposition = null;
    if (reason === 'cancelled' && disposition === 'requeue') {
      store.requeue(item.id);
      return false; // stop the loop: an immediate restart would regenerate the same item
    }
    if (reason === 'cancelled' && disposition === 'discard') {
      discardSilently(item);
      return true;
    }
    notifyFailed(item.id, reason);
    store.drop(item.id, reason);
    if (reason === 'api' || reason === 'empty') {
      consecutive += 1;
      if (consecutive >= effectiveThreshold(getThreshold)) {
        pause('failures');
        for (const cb of breakerListeners) cb({ n: consecutive });
      }
    }
    return true;
  }

  async function loop() {
    while (true) {
      if (pauseReasons.size) return;
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
    if (pauseReasons.size) return;
    if (running) return;
    running = true;
    try {
      await loop();
    } finally {
      running = false;
    }
  }

  /**
   * Hold the runner for `reason`: wake() becomes a no-op until every reason is cleared. Does not
   * abort an item already mid-generate(); that item is parked (when reason is 'native') instead.
   */
  function pause(reason = 'native') {
    if (pauseReasons.has(reason)) return;
    pauseReasons.add(reason);
    emitState();
  }

  /** Clear one reason (or all when omitted) and kick the runner. Returns wake()'s promise. */
  function resume(reason) {
    const before = pauseReasons.size;
    if (reason === undefined) {
      pauseReasons.clear();
      consecutive = 0;
    } else {
      pauseReasons.delete(reason);
      if (reason === 'failures') consecutive = 0;
    }
    if (pauseReasons.size !== before) emitState();
    return wake();
  }

  function resumeAll() {
    return resume();
  }

  function isPaused() {
    return pauseReasons.size > 0;
  }

  function getPauseReasons() {
    return [...pauseReasons];
  }

  function getPrimaryReason() {
    return PAUSE_PRIORITY.find((r) => pauseReasons.has(r)) ?? null;
  }

  function getConsecutiveFailures() {
    return consecutive;
  }

  function resetCounters() {
    consecutive = 0;
  }

  function onBreakerTrip(cb) {
    breakerListeners.add(cb);
  }

  function offBreakerTrip(cb) {
    breakerListeners.delete(cb);
  }

  function onInspectorPause(cb) {
    inspectorListeners.add(cb);
  }

  function offInspectorPause(cb) {
    inspectorListeners.delete(cb);
  }

  function onStateChange(cb) {
    stateListeners.add(cb);
  }

  function offStateChange(cb) {
    stateListeners.delete(cb);
  }

  /** Invalidate every in-flight or parked result: it will be discarded silently. */
  function invalidate() {
    epoch += 1;
  }

  function onItemFailed(cb) {
    failedListeners.add(cb);
  }

  function offItemFailed(cb) {
    failedListeners.delete(cb);
  }

  function onItemDone(cb) {
    doneListeners.add(cb);
  }

  function offItemDone(cb) {
    doneListeners.delete(cb);
  }

  /**
   * Abort the item currently mid-generate(), if any (QUEUE-06/D-02). Delegates to adapter.js's
   * abortOwn(), which only ever touches this runner's own AbortController — never ST's global
   * stop function. send() already resolves { aborted: true } rather than throwing, so the
   * aborted item is dropped with reason 'cancelled' by processNext()'s existing error-handling
   * branch, unmodified.
   */
  function abortRunning({ disposition = 'cancel' } = {}) {
    if (!runningController) return { aborted: false };
    abortDisposition = disposition;
    return abortOwn(runningController);
  }

  return {
    wake,
    pause,
    resume,
    resumeAll,
    isPaused,
    getPauseReasons,
    getPrimaryReason,
    getConsecutiveFailures,
    getFailureCount: getConsecutiveFailures,
    resetCounters,
    onBreakerTrip,
    offBreakerTrip,
    onInspectorPause,
    offInspectorPause,
    onStateChange,
    offStateChange,
    invalidate,
    onItemFailed,
    offItemFailed,
    abortRunning,
    onItemDone,
    offItemDone,
  };
}
