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
    return Math.min(maxQueueSize, HARD_MAX_QUEUE);
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

  return {
    add,
    peekNext,
    markRunning,
    markDone,
    drop,
    pendingCount,
    runningCount,
    getItems,
    onChange,
    offChange,
  };
}
