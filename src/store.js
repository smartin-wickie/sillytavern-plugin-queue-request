// In-memory queue store (D-04/D-06, QUEUE-02). Plain data in/out, no DOM/bridge coupling
// beyond the one `bridge` param, so Phase 4 can later wrap add()/markDone()/drop() with
// chat_metadata persistence (PERS-01) without changing this public shape. No chat_metadata
// read/write happens in this plan — the store is in-memory-only for now.

export const DEFAULT_MAX_QUEUE = 5;
export const HARD_MAX_QUEUE = 20;

let fallbackCounter = 0;

function nextId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `item-${fallbackCounter}`;
}

/**
 * Create a queue store. `bridge` is accepted (and reserved for a future Phase 4 persistence
 * wrapper) but not read by this plan's in-memory implementation.
 */
export function createStore({ bridge, maxQueueSize = DEFAULT_MAX_QUEUE } = {}) {
  const items = [];
  const listeners = new Set();
  const resetListeners = new Set();

  function notify() {
    for (const cb of listeners) cb();
  }

  function pendingCount() {
    return items.filter((item) => item.status === 'queued').length;
  }

  function runningCount() {
    return items.filter((item) => item.status === 'running').length;
  }

  // The hard ceiling binds independently of whatever maxQueueSize the caller configured
  // (T-02-02-03) — a future settings bug (Phase 3 SET-01) cannot grow the effective cap past 20.
  function effectiveCap() {
    const configured = Number.isFinite(maxQueueSize) ? maxQueueSize : DEFAULT_MAX_QUEUE;
    return Math.min(configured, HARD_MAX_QUEUE);
  }

  function findById(id) {
    return items.find((item) => item.id === id);
  }

  function add(fingerprint) {
    if (pendingCount() + runningCount() >= effectiveCap()) {
      return { ok: false, reason: 'max' };
    }
    const item = {
      id: nextId(),
      createdAt: new Date(),
      status: 'queued',
      attempts: 0,
      fingerprint,
    };
    items.push(item);
    notify();
    return { ok: true, item };
  }

  function peekNext() {
    return items.find((item) => item.status === 'queued');
  }

  function markRunning(id) {
    const item = findById(id);
    if (!item) return;
    item.status = 'running';
    notify();
  }

  function requeue(id) {
    const item = findById(id);
    if (!item || item.status !== 'running') return;
    item.status = 'queued';
    notify();
  }

  function markDone(id) {
    const item = findById(id);
    if (!item) return;
    item.status = 'done';
    notify();
  }

  function drop(id, reason) {
    const item = findById(id);
    if (!item) return;
    item.status = 'failed';
    item.reason = reason;
    notify();
  }

  // Fails every queued/running item with `reason` (items stay in the array like other terminal
  // statuses). Reset listeners fire before the change notification so a run accumulator is
  // zeroed before it can observe the queue draining. Returns the number cleared.
  function clear(reason) {
    const active = items.filter((item) => item.status === 'queued' || item.status === 'running');
    if (active.length === 0) return 0;
    for (const item of active) {
      item.status = 'failed';
      item.reason = reason;
    }
    for (const cb of [...resetListeners]) cb();
    notify();
    return active.length;
  }

  // Re-keys queued/running fingerprints in place so a runner holding an item reference sees
  // the new values. Done/failed items are left untouched.
  function refingerprintAll(fp) {
    let touched = false;
    for (const item of items) {
      if (item.status !== 'queued' && item.status !== 'running') continue;
      item.fingerprint = Object.assign(item.fingerprint ?? {}, fp);
      touched = true;
    }
    if (touched) notify();
  }

  function onReset(cb) {
    resetListeners.add(cb);
  }

  function offReset(cb) {
    resetListeners.delete(cb);
  }

  function getItems() {
    // Shallow copy — never the live internal array.
    return items.slice();
  }

  function onChange(cb) {
    listeners.add(cb);
  }

  function offChange(cb) {
    listeners.delete(cb);
  }

  // Exposes the same cap add() enforces (effectiveCap(), not the raw configured maxQueueSize)
  // so callers computing a disabled/full-queue UI state check against the exact same number
  // add() uses, rather than re-deriving a second value that could drift from it.
  function getMaxQueueSize() {
    return effectiveCap();
  }

  // Changes the configured cap on the already-constructed store instance, so a settings-panel
  // edit (SET-01/D-12) takes effect on the very next add()/getMaxQueueSize() call — no reload,
  // no re-creating the store. Reassigns the function's own `maxQueueSize` parameter, which
  // effectiveCap() already closes over, so no new internal variable is needed. Silently no-ops
  // on a non-finite input rather than letting a bad write corrupt the cap (T-03-04-05).
  // notify()s the same listeners add()/markRunning()/markDone()/drop() already notify, so a
  // UI subscribed via onChange() re-renders against the new effectiveCap() immediately.
  function setMaxQueueSize(n) {
    if (!Number.isFinite(n)) return;
    maxQueueSize = n;
    notify();
  }

  return {
    add,
    peekNext,
    markRunning,
    requeue,
    markDone,
    drop,
    clear,
    refingerprintAll,
    onReset,
    offReset,
    pendingCount,
    runningCount,
    getItems,
    onChange,
    offChange,
    getMaxQueueSize,
    setMaxQueueSize,
  };
}
