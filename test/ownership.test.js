import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOwnership, HEARTBEAT_MS, LEASE_TIMEOUT_MS, CLAIM_VERIFY_MS } from '../src/ownership.js';

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

function makeWin() {
  const handlers = new Map();
  return {
    addEventListener: (t, h) => {
      if (!handlers.has(t)) handlers.set(t, new Set());
      handlers.get(t).add(h);
    },
    removeEventListener: (t, h) => handlers.get(t)?.delete(h),
    dispatch: (t, ev) => {
      for (const h of [...(handlers.get(t) ?? [])]) h(ev);
    },
    count: (t) => handlers.get(t)?.size ?? 0,
  };
}

const KEY = 'chat-a';
const LEASE = `queuedSwipes:lease:${KEY}`;
const STATE = `queuedSwipes:state:${KEY}`;

function tab(storage, win = makeWin(), id) {
  const own = createOwnership({ storage, win, tabId: id });
  own.start();
  return { own, win };
}

async function claim(own, key = KEY) {
  const p = own.claim(key);
  await vi.advanceTimersByTimeAsync(CLAIM_VERIFY_MS + 1);
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('claim', () => {
  it('first claim wins and writes a lease', async () => {
    const storage = makeStorage();
    const { own } = tab(storage, undefined, 'A');
    expect(await claim(own)).toEqual({ role: 'owner' });
    expect(JSON.parse(storage.getItem(LEASE)).tabId).toBe('A');
    expect(own.isOwner()).toBe(true);
  });

  it('second tab is read-only and does not write', async () => {
    const storage = makeStorage();
    const a = tab(storage, undefined, 'A').own;
    await claim(a);
    const b = tab(storage, undefined, 'B').own;
    const res = await b.claim(KEY);
    expect(res).toEqual({ role: 'readonly' });
    expect(b.isOwner()).toBe(false);
    expect(JSON.parse(storage.getItem(LEASE)).tabId).toBe('A');
  });

  it('a stale lease at claim time is a normal owner load, not a takeover', async () => {
    const storage = makeStorage({
      [LEASE]: JSON.stringify({ tabId: 'dead', ts: Date.now() - LEASE_TIMEOUT_MS - 1 }),
    });
    const { own } = tab(storage, undefined, 'A');
    const changes = vi.fn();
    own.onRoleChange(changes);
    expect(await claim(own)).toEqual({ role: 'owner' });
    expect(changes).not.toHaveBeenCalled();
  });

  it('simultaneous claims: the overwritten one resolves read-only', async () => {
    const storage = makeStorage();
    const a = tab(storage, undefined, 'A').own;
    const b = tab(storage, undefined, 'B').own;
    const pa = a.claim(KEY);
    const pb = b.claim(KEY);
    await vi.advanceTimersByTimeAsync(CLAIM_VERIFY_MS + 1);
    const roles = [(await pa).role, (await pb).role].sort();
    expect(roles).toEqual(['owner', 'readonly']);
  });
});

describe('default timers', () => {
  // Browser timer globals throw "Illegal invocation" when called with a foreign `this`.
  it('claims and heartbeats with this-sensitive global timers', async () => {
    const strict = (orig) => function (...args) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return orig(...args);
    };
    vi.stubGlobal('setTimeout', strict(globalThis.setTimeout));
    vi.stubGlobal('setInterval', strict(globalThis.setInterval));
    vi.stubGlobal('clearInterval', strict(globalThis.clearInterval));
    try {
      const storage = makeStorage();
      const { own } = tab(storage, makeWin(), 'tab-a');
      expect(await claim(own)).toEqual({ role: 'owner' });
      const ts = JSON.parse(storage.getItem(LEASE)).ts;
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS + 1);
      expect(JSON.parse(storage.getItem(LEASE)).ts).toBeGreaterThan(ts);
      own.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('heartbeat, demotion and takeover', () => {
  it('owner heartbeat refreshes the lease ts', async () => {
    const storage = makeStorage();
    const { own } = tab(storage, undefined, 'A');
    await claim(own);
    const before = JSON.parse(storage.getItem(LEASE)).ts;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(JSON.parse(storage.getItem(LEASE)).ts).toBeGreaterThan(before);
  });

  it('owner demotes once when a foreign lease appears', async () => {
    const storage = makeStorage();
    const { own } = tab(storage, undefined, 'A');
    await claim(own);
    const changes = vi.fn();
    own.onRoleChange(changes);
    storage.setItem(LEASE, JSON.stringify({ tabId: 'B', ts: Date.now() }));
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledWith({ role: 'readonly', reason: 'demoted' });
    expect(own.isOwner()).toBe(false);
  });

  it('owner demotes when the lease goes missing', async () => {
    const storage = makeStorage();
    const { own } = tab(storage, undefined, 'A');
    await claim(own);
    const changes = vi.fn();
    own.onRoleChange(changes);
    storage.removeItem(LEASE);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(changes).toHaveBeenCalledWith({ role: 'readonly', reason: 'demoted' });
  });

  it('read-only tab takes over after the owner stops heartbeating (about 5s)', async () => {
    const storage = makeStorage();
    const a = tab(storage, undefined, 'A').own;
    await claim(a);
    const b = tab(storage, undefined, 'B').own;
    await b.claim(KEY);
    const changes = vi.fn();
    b.onRoleChange(changes);
    a.stop(); // owner vanishes; stop() releases, so simulate a crash instead
    storage.setItem(LEASE, JSON.stringify({ tabId: 'A', ts: Date.now() }));
    await vi.advanceTimersByTimeAsync(LEASE_TIMEOUT_MS + HEARTBEAT_MS + CLAIM_VERIFY_MS + 50);
    expect(changes).toHaveBeenCalledWith({ role: 'owner', reason: 'takeover' });
    expect(b.isOwner()).toBe(true);
    expect(JSON.parse(storage.getItem(LEASE)).tabId).toBe('B');
  });

  it('read-only tab takes over at once when the lease is removed (storage event)', async () => {
    const storage = makeStorage();
    const a = tab(storage, undefined, 'A').own;
    await claim(a);
    const { own: b, win } = tab(storage, undefined, 'B');
    await b.claim(KEY);
    const changes = vi.fn();
    b.onRoleChange(changes);
    storage.removeItem(LEASE);
    win.dispatch('storage', { key: LEASE, newValue: null });
    await vi.advanceTimersByTimeAsync(CLAIM_VERIFY_MS + 1);
    expect(changes).toHaveBeenCalledWith({ role: 'owner', reason: 'takeover' });
  });
});

describe('release', () => {
  it('release removes only own lease and state, and clears the timer', async () => {
    const storage = makeStorage();
    const clear = vi.fn((h) => clearInterval(h));
    const own = createOwnership({
      storage,
      tabId: 'A',
      timers: { setInterval, clearInterval: clear, setTimeout },
    });
    own.start();
    await claim(own);
    own.publishState({ items: [] });
    expect(storage.getItem(STATE)).not.toBeNull();
    own.release();
    expect(storage.getItem(LEASE)).toBeNull();
    expect(storage.getItem(STATE)).toBeNull();
    expect(clear).toHaveBeenCalled();
    expect(own.getRole()).toBeNull();
  });

  it('release does not remove a foreign lease', async () => {
    const storage = makeStorage();
    const a = tab(storage, undefined, 'A').own;
    await claim(a);
    const b = tab(storage, undefined, 'B').own;
    await b.claim(KEY);
    b.release();
    expect(JSON.parse(storage.getItem(LEASE)).tabId).toBe('A');
  });

  it('pagehide releases the lease', async () => {
    const storage = makeStorage();
    const { own, win } = tab(storage, undefined, 'A');
    await claim(own);
    win.dispatch('pagehide', {});
    expect(storage.getItem(LEASE)).toBeNull();
  });

  it('stop removes the window listeners', () => {
    const storage = makeStorage();
    const { own, win } = tab(storage, undefined, 'A');
    expect(win.count('storage')).toBe(1);
    own.stop();
    expect(win.count('storage')).toBe(0);
    expect(win.count('pagehide')).toBe(0);
  });
});

describe('untrusted storage and fail-open', () => {
  it('garbage lease values are treated as absent', async () => {
    for (const bad of ['not json', '[]', '"x"', 'null', JSON.stringify({ tabId: 5, ts: 'x' })]) {
      const storage = makeStorage({ [LEASE]: bad });
      const { own } = tab(storage, undefined, 'A');
      expect(await claim(own)).toEqual({ role: 'owner' });
    }
  });

  it('garbage state values read as null', async () => {
    const storage = makeStorage();
    const { own } = tab(storage, undefined, 'A');
    await claim(own);
    storage.setItem(STATE, 'garbage');
    expect(own.readState()).toBeNull();
    storage.setItem(STATE, JSON.stringify({ tabId: 'B', ts: 1, snapshot: [] }));
    expect(own.readState()).toBeNull();
    storage.setItem(STATE, JSON.stringify({ tabId: 'B', ts: 1, snapshot: { items: [] } }));
    expect(own.readState()).toEqual({ tabId: 'B', ts: 1, snapshot: { items: [] } });
  });

  it('a throwing localStorage fails open', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {},
    };
    const { own } = tab(storage, undefined, 'A');
    expect(await claim(own)).toEqual({ role: 'owner' });
    expect(own.isOwner()).toBe(true);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('a null storage fails open', async () => {
    const own = createOwnership({ storage: null, tabId: 'A' });
    own.start();
    expect(await own.claim(KEY)).toEqual({ role: 'owner' });
    expect(own.isOwner()).toBe(true);
  });

  it('isOwner is true before any claim', () => {
    const own = createOwnership({ storage: makeStorage(), tabId: 'A' });
    expect(own.isOwner()).toBe(true);
  });
});

describe('state mirror and housekeeping', () => {
  it('publishState writes only as owner', async () => {
    const storage = makeStorage();
    const a = tab(storage, undefined, 'A').own;
    await claim(a);
    const b = tab(storage, undefined, 'B').own;
    await b.claim(KEY);
    b.publishState({ items: [1] });
    expect(storage.getItem(STATE)).toBeNull();
    a.publishState({ items: [] });
    expect(JSON.parse(storage.getItem(STATE)).tabId).toBe('A');
  });

  it('onState fires from a storage event on the state key', async () => {
    const storage = makeStorage();
    const { own, win } = tab(storage, undefined, 'B');
    await claim(own);
    const cb = vi.fn();
    own.onState(cb);
    storage.setItem(STATE, JSON.stringify({ tabId: 'A', ts: Date.now(), snapshot: { n: 1 } }));
    win.dispatch('storage', { key: STATE, newValue: storage.getItem(STATE) });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ snapshot: { n: 1 } }));
    own.offState(cb);
  });

  it('start removes queuedSwipes keys older than one hour', () => {
    const old = Date.now() - 2 * 60 * 60 * 1000;
    const storage = makeStorage({
      'queuedSwipes:lease:old': JSON.stringify({ tabId: 'x', ts: old }),
      'queuedSwipes:state:fresh': JSON.stringify({ tabId: 'x', ts: Date.now(), snapshot: {} }),
      other: 'keep',
    });
    tab(storage, undefined, 'A');
    expect(storage.getItem('queuedSwipes:lease:old')).toBeNull();
    expect(storage.getItem('queuedSwipes:state:fresh')).not.toBeNull();
    expect(storage.getItem('other')).toBe('keep');
  });
});
