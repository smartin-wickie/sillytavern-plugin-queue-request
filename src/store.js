// In-memory queue store (D-04/D-06, QUEUE-02). Plain data in/out, no DOM/bridge coupling
// beyond the one `bridge` param, so Phase 4 can later wrap add()/markDone()/drop() with
// chat_metadata persistence (PERS-01) without changing this public shape. No chat_metadata
// read/write happens in this plan — the store is in-memory-only for now.

import { serialize } from './persistence.js';

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
export function createStore({ bridge, maxQueueSize = DEFAULT_MAX_QUEUE, moduleName = 'queuedSwipes' } = {}) {
  let items = [];
  let boundKey = null;
  let boundIntegrity = null;
  let readOnly = false;
  let completedRun = 0;
  let snapshotStats = { reasons: [], failures: 0, completed: 0 };
  const readOnlyListeners = new Set();
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

  // Writes the queue into the live chat metadata, but only while the live chat is still the one
  // the store is bound to. ctx().chatMetadata is replaced on every chat load, so it is always
  // read fresh; a switch in flight (different key/integrity, or cleared chat) refuses the write
  // so queued items can never land in another chat. Only ST save functions are used. The
  // debounced save may be cancelled by ST's clearChat within ~1s of a switch, which is why
  // enqueue saves immediately; a lost cancel/clear/done write only re-shows an item in the
  // resume consent popup.
  function writeMetadata(excludeId) {
    if (readOnly) return null;
    if (boundKey === null) return null;
    let c;
    try {
      c = bridge.ctx();
    } catch {
      return null;
    }
    if (typeof bridge.chatKey !== 'function' || bridge.chatKey(c) !== boundKey) return null;
    if (!Array.isArray(c.chat) || c.chat.length === 0) return null;
    const meta = c.chatMetadata;
    if (!meta || (meta.integrity ?? null) !== boundIntegrity) return null;
    const list = excludeId === undefined ? items : items.filter((i) => i.id !== excludeId);
    const blob = serialize(list);
    if (blob.items.length === 0) delete meta[moduleName];
    else meta[moduleName] = blob;
    return c;
  }

  function persist({ immediate = false } = {}) {
    const c = writeMetadata();
    if (!c) return;
    try {
      if (immediate) {
        const r = c.saveChat?.();
        if (r && typeof r.catch === 'function') {
          r.catch((err) => console.warn('[queuedSwipes] saveChat failed', err));
        }
      } else {
        c.saveMetadataDebounced?.();
      }
    } catch (err) {
      console.warn('[queuedSwipes] persist failed', err);
    }
  }

  // Updates the metadata as if `id` were already gone, without triggering a save: the
  // appender's own saveChat then carries the updated queue in the same write.
  function persistExcluding(id) {
    writeMetadata(id);
  }

  function bindChat(key, integrity) {
    boundKey = key ?? null;
    boundIntegrity = integrity ?? null;
  }

  function unbind() {
    boundKey = null;
    boundIntegrity = null;
  }

  // Replaces the in-memory queue wholesale (chat load). Never persists.
  function rebind(newItems) {
    items = Array.isArray(newItems) ? newItems.slice() : [];
    completedRun = 0;
    for (const cb of [...resetListeners]) cb();
    notify();
  }

  function findById(id) {
    return items.find((item) => item.id === id);
  }

  function snapshotConnection() {
    try {
      const snap = bridge?.connectionSnapshot?.();
      return snap ? { ...snap } : null;
    } catch {
      return null;
    }
  }

  // Read-only (non-owner tab or claim window): nothing is added and nothing persists.
  function setReadOnly(flag) {
    const next = Boolean(flag);
    if (next === readOnly) return;
    readOnly = next;
    for (const cb of [...readOnlyListeners]) cb();
    notify();
  }

  function onReadOnlyChange(cb) {
    readOnlyListeners.add(cb);
  }

  function offReadOnlyChange(cb) {
    readOnlyListeners.delete(cb);
  }

  // Completed items of the current run: the owner counts markDone calls; a read-only tab
  // reports the owner's published figure.
  function getCompleted() {
    return readOnly ? snapshotStats.completed : completedRun;
  }

  function getSnapshotStats() {
    return { reasons: [...snapshotStats.reasons], failures: snapshotStats.failures, completed: snapshotStats.completed };
  }

  // Display-only: replaces items with a validated snapshot from the owning tab. Never persists
  // and is ignored unless this tab is read-only.
  function applySnapshot(parsed) {
    if (!readOnly || !parsed || !Array.isArray(parsed.items)) return;
    items = parsed.items.map((it) => ({
      id: it.id,
      status: it.status,
      createdAt: new Date(it.createdAt),
      fingerprint: null,
      connection: null,
      attempts: 0,
    }));
    snapshotStats = {
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice() : [],
      failures: Number.isFinite(parsed.failures) ? parsed.failures : 0,
      completed: Number.isFinite(parsed.completed) ? parsed.completed : 0,
    };
    notify();
  }

  function isReadOnly() {
    return readOnly;
  }

  function add(fingerprint) {
    if (readOnly) return { ok: false, reason: 'readonly' };
    if (pendingCount() + runningCount() >= effectiveCap()) {
      return { ok: false, reason: 'max' };
    }
    if (pendingCount() + runningCount() === 0) completedRun = 0;
    const item = {
      id: nextId(),
      createdAt: new Date(),
      status: 'queued',
      attempts: 0,
      fingerprint,
      connection: snapshotConnection(),
    };
    items.push(item);
    notify();
    persist({ immediate: true });
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
    persist();
  }

  function markDone(id) {
    const item = findById(id);
    if (!item) return;
    item.status = 'done';
    completedRun += 1;
    notify();
    persist();
  }

  function drop(id, reason) {
    const item = findById(id);
    if (!item) return;
    item.status = 'failed';
    item.reason = reason;
    notify();
    persist();
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
    completedRun = 0;
    for (const cb of [...resetListeners]) cb();
    notify();
    persist();
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

  // Records `snapshot` as the connection of every queued/running item (user consented to the
  // current connection). Each item gets its own copy.
  function setConnectionAll(snapshot) {
    if (!snapshot) return;
    let touched = false;
    for (const item of items) {
      if (item.status !== 'queued' && item.status !== 'running') continue;
      item.connection = { ...snapshot };
      touched = true;
    }
    if (!touched) return;
    notify();
    persist();
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
    setConnectionAll,
    onReset,
    offReset,
    persist,
    persistExcluding,
    setReadOnly,
    isReadOnly,
    onReadOnlyChange,
    offReadOnlyChange,
    getCompleted,
    getSnapshotStats,
    applySnapshot,
    bindChat,
    unbind,
    rebind,
    pendingCount,
    runningCount,
    getItems,
    onChange,
    offChange,
    getMaxQueueSize,
    setMaxQueueSize,
  };
}
