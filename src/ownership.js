// Per-chat queue ownership across browser tabs. A localStorage lease (with a heartbeat and
// `storage` events) makes the first tab that opens a chat its owner; later tabs are read-only
// and take over only when the owner's lease goes stale. Every external dependency (storage,
// clock, timers, window) is injected so the module is unit-testable without a browser. Lease
// and state values are untrusted: they are parsed defensively and never treated as the queue of
// record (that is chat_metadata).

export const HEARTBEAT_MS = 2000;
export const LEASE_TIMEOUT_MS = 5000;
export const CLAIM_VERIFY_MS = 100;

const PREFIX = 'queuedSwipes:';
const LEASE_PREFIX = `${PREFIX}lease:`;
const STATE_PREFIX = `${PREFIX}state:`;
const HOUSEKEEPING_MAX_AGE_MS = 60 * 60 * 1000;

let fallbackTab = 0;

function makeTabId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackTab += 1;
  return `tab-${Date.now().toString(36)}-${fallbackTab}-${Math.random().toString(36).slice(2)}`;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function createOwnership({
  storage,
  now = Date.now,
  timers = { setInterval, clearInterval, setTimeout },
  win,
  tabId = makeTabId(),
} = {}) {
  let chatKey = null;
  let role = null; // 'owner' | 'readonly' | null
  let ticker = null;
  let claimSeq = 0;
  let takingOver = false;
  let failOpen = !storage;
  let warned = false;
  let started = false;
  const roleListeners = new Set();
  const stateListeners = new Set();

  function failOpenOnce(err) {
    failOpen = true;
    if (!warned) {
      warned = true;
      console.warn('[queuedSwipes] localStorage unavailable; running this tab as owner', err);
    }
  }

  function leaseKey(key) {
    return `${LEASE_PREFIX}${key}`;
  }

  function stateKey(key) {
    return `${STATE_PREFIX}${key}`;
  }

  function parse(raw) {
    if (typeof raw !== 'string') return null;
    try {
      const v = JSON.parse(raw);
      return isPlainObject(v) ? v : null;
    } catch {
      return null;
    }
  }

  function readLease(key) {
    try {
      const v = parse(storage.getItem(leaseKey(key)));
      if (!v || typeof v.tabId !== 'string' || !Number.isFinite(v.ts)) return null;
      return { tabId: v.tabId, ts: v.ts };
    } catch (err) {
      failOpenOnce(err);
      return null;
    }
  }

  function writeLease(key) {
    try {
      storage.setItem(leaseKey(key), JSON.stringify({ tabId, ts: now() }));
      return true;
    } catch (err) {
      failOpenOnce(err);
      return false;
    }
  }

  function isFresh(lease) {
    return Boolean(lease) && now() - lease.ts < LEASE_TIMEOUT_MS;
  }

  function emitRole(change) {
    for (const cb of [...roleListeners]) cb(change);
  }

  function clearTicker() {
    if (ticker !== null) {
      timers.clearInterval(ticker);
      ticker = null;
    }
  }

  function startTicker() {
    clearTicker();
    ticker = timers.setInterval(tick, HEARTBEAT_MS);
  }

  function demote() {
    if (role !== 'owner') return;
    role = 'readonly';
    // Keep a watcher running so a later stale lease can still be taken over.
    startTicker();
    emitRole({ role: 'readonly', reason: 'demoted' });
  }

  // Owner heartbeat: read back first so a foreign or missing lease demotes this tab (D-10).
  function heartbeat() {
    const lease = readLease(chatKey);
    if (failOpen) return;
    if (!lease || lease.tabId !== tabId) {
      demote();
      return;
    }
    writeLease(chatKey);
  }

  function tick() {
    if (chatKey === null || failOpen) return;
    if (role === 'owner') heartbeat();
    else if (role === 'readonly') maybeTakeOver();
  }

  function maybeTakeOver() {
    if (takingOver || role !== 'readonly' || chatKey === null) return;
    const lease = readLease(chatKey);
    if (failOpen) return;
    if (lease && lease.tabId !== tabId && isFresh(lease)) return;
    takingOver = true;
    const key = chatKey;
    const seq = claimSeq;
    acquire(key, seq).then((won) => {
      takingOver = false;
      if (!won || seq !== claimSeq || chatKey !== key) return;
      role = 'owner';
      startTicker();
      emitRole({ role: 'owner', reason: 'takeover' });
    });
  }

  // Write, wait, re-read: a simultaneous claimer that overwrote us wins; we resolve false.
  function acquire(key, seq) {
    if (!writeLease(key)) return Promise.resolve(true);
    return new Promise((resolve) => {
      timers.setTimeout(() => {
        if (seq !== claimSeq) {
          resolve(false);
          return;
        }
        const lease = readLease(key);
        resolve(failOpen || (lease !== null && lease.tabId === tabId));
      }, CLAIM_VERIFY_MS);
    });
  }

  async function claim(key) {
    claimSeq += 1;
    const seq = claimSeq;
    clearTicker();
    chatKey = key;
    takingOver = false;
    if (failOpen || !storage) {
      role = 'owner';
      return { role: 'owner' };
    }
    const lease = readLease(key);
    if (failOpen) {
      role = 'owner';
      return { role: 'owner' };
    }
    if (lease && lease.tabId !== tabId && isFresh(lease)) {
      role = 'readonly';
      startTicker();
      return { role: 'readonly' };
    }
    const won = await acquire(key, seq);
    if (seq !== claimSeq) return { role: 'readonly' };
    if (won) {
      role = 'owner';
      if (!failOpen) startTicker();
      return { role: 'owner' };
    }
    role = 'readonly';
    startTicker();
    return { role: 'readonly' };
  }

  function release() {
    claimSeq += 1;
    clearTicker();
    takingOver = false;
    if (chatKey !== null && storage && !failOpen) {
      try {
        const lease = readLease(chatKey);
        if (lease && lease.tabId === tabId) storage.removeItem(leaseKey(chatKey));
        const st = parse(storage.getItem(stateKey(chatKey)));
        if (st && st.tabId === tabId) storage.removeItem(stateKey(chatKey));
      } catch (err) {
        failOpenOnce(err);
      }
    }
    chatKey = null;
    role = null;
  }

  function isOwner() {
    return failOpen || role !== 'readonly';
  }

  function getRole() {
    return role;
  }

  function onStorage(event) {
    if (!event || chatKey === null || failOpen) return;
    if (event.key === leaseKey(chatKey)) {
      if (role === 'owner') {
        heartbeatCheckOnly();
      } else if (role === 'readonly') {
        const lease = parse(event.newValue);
        const valid = lease && typeof lease.tabId === 'string' && Number.isFinite(lease.ts);
        if (!valid || !isFresh(lease)) maybeTakeOver();
      }
    } else if (event.key === stateKey(chatKey)) {
      const snap = readState();
      if (snap) for (const cb of [...stateListeners]) cb(snap);
    }
  }

  // A storage event only fires for another document's write; if that write replaced our lease
  // we are no longer the owner.
  function heartbeatCheckOnly() {
    const lease = readLease(chatKey);
    if (!failOpen && lease && lease.tabId !== tabId) demote();
  }

  function onPageHide() {
    release();
  }

  function housekeeping() {
    try {
      const stale = [];
      for (let i = 0; i < storage.length; i += 1) {
        const k = storage.key(i);
        if (typeof k !== 'string' || !k.startsWith(PREFIX)) continue;
        const v = parse(storage.getItem(k));
        if (!v || !Number.isFinite(v.ts) || now() - v.ts > HOUSEKEEPING_MAX_AGE_MS) stale.push(k);
      }
      for (const k of stale) storage.removeItem(k);
    } catch (err) {
      failOpenOnce(err);
    }
  }

  function start() {
    if (started) return;
    started = true;
    win?.addEventListener?.('storage', onStorage);
    win?.addEventListener?.('pagehide', onPageHide);
    if (storage) housekeeping();
  }

  function stop() {
    if (started) {
      win?.removeEventListener?.('storage', onStorage);
      win?.removeEventListener?.('pagehide', onPageHide);
      started = false;
    }
    release();
  }

  function onRoleChange(cb) {
    roleListeners.add(cb);
  }

  function offRoleChange(cb) {
    roleListeners.delete(cb);
  }

  function publishState(snapshot) {
    if (role !== 'owner' || chatKey === null || failOpen || !storage) return;
    try {
      storage.setItem(stateKey(chatKey), JSON.stringify({ tabId, ts: now(), snapshot }));
    } catch (err) {
      failOpenOnce(err);
    }
  }

  function readState() {
    if (chatKey === null || failOpen || !storage) return null;
    try {
      const v = parse(storage.getItem(stateKey(chatKey)));
      if (!v || typeof v.tabId !== 'string' || !Number.isFinite(v.ts) || !isPlainObject(v.snapshot)) {
        return null;
      }
      return { tabId: v.tabId, ts: v.ts, snapshot: v.snapshot };
    } catch (err) {
      failOpenOnce(err);
      return null;
    }
  }

  function onState(cb) {
    stateListeners.add(cb);
  }

  function offState(cb) {
    stateListeners.delete(cb);
  }

  return {
    start,
    stop,
    claim,
    release,
    isOwner,
    getRole,
    onRoleChange,
    offRoleChange,
    publishState,
    readState,
    onState,
    offState,
  };
}
