import { describe, expect, it, vi } from 'vitest';
import { createStore, DEFAULT_MAX_QUEUE, HARD_MAX_QUEUE } from '../src/store.js';

function makeFakeBridge() {
  return {
    ctx: () => ({
      chat: [],
      eventSource: { on: vi.fn(), removeListener: vi.fn(), makeLast: vi.fn() },
      eventTypes: {},
      swipe: { state: () => 'none', isAllowed: () => true, refresh: vi.fn() },
      saveChat: vi.fn(),
    }),
  };
}

function fp(mesId = 0) {
  return { chatId: 'chat-1', integrity: null, mesId, chatLength: 1, swipe0Hash: 'h', name: 'Bot' };
}

describe('createStore', () => {
  it('exports DEFAULT_MAX_QUEUE = 5 and HARD_MAX_QUEUE = 20', () => {
    expect(DEFAULT_MAX_QUEUE).toBe(5);
    expect(HARD_MAX_QUEUE).toBe(20);
  });

  it('add() succeeds while pendingCount()+runningCount() < maxQueueSize', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 5 });
    for (let i = 0; i < 5; i++) {
      const result = store.add(fp(i));
      expect(result.ok).toBe(true);
      expect(result.item.fingerprint).toEqual(fp(i));
    }
    expect(store.getItems()).toHaveLength(5);
  });

  it('add() refuses once pendingCount()+runningCount() === maxQueueSize, without mutating items', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 5 });
    for (let i = 0; i < 5; i++) store.add(fp(i));
    const before = store.getItems();
    const result = store.add(fp(99));
    expect(result).toEqual({ ok: false, reason: 'max' });
    expect(store.getItems()).toEqual(before);
    expect(store.getItems()).toHaveLength(5);
  });

  it('refuses once pendingCount()+runningCount() reaches HARD_MAX_QUEUE even when maxQueueSize is configured higher', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 25 });
    for (let i = 0; i < HARD_MAX_QUEUE; i++) {
      const result = store.add(fp(i));
      expect(result.ok).toBe(true);
    }
    const result = store.add(fp(999));
    expect(result).toEqual({ ok: false, reason: 'max' });
    expect(store.getItems()).toHaveLength(HARD_MAX_QUEUE);
  });

  it('peekNext() returns the oldest item with status "queued" (FIFO), or undefined when none', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 5 });
    expect(store.peekNext()).toBeUndefined();

    const first = store.add(fp(0)).item;
    const second = store.add(fp(1)).item;

    expect(store.peekNext().id).toBe(first.id);

    store.markRunning(first.id);
    expect(store.peekNext().id).toBe(second.id);

    store.markRunning(second.id);
    expect(store.peekNext()).toBeUndefined();
  });

  it('markRunning(id) transitions exactly one item and updates runningCount()', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 5 });
    const a = store.add(fp(0)).item;
    const b = store.add(fp(1)).item;

    store.markRunning(a.id);

    const items = store.getItems();
    expect(items.find((i) => i.id === a.id).status).toBe('running');
    expect(items.find((i) => i.id === b.id).status).toBe('queued');
    expect(store.runningCount()).toBe(1);
    expect(store.pendingCount()).toBe(1);
  });

  it('markDone(id) transitions exactly one item and removes it from pending/running counts', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 5 });
    const a = store.add(fp(0)).item;
    const b = store.add(fp(1)).item;
    store.markRunning(a.id);

    store.markDone(a.id);

    const items = store.getItems();
    expect(items.find((i) => i.id === a.id).status).toBe('done');
    expect(items.find((i) => i.id === b.id).status).toBe('queued');
    expect(store.runningCount()).toBe(0);
    expect(store.pendingCount()).toBe(1);
  });

  it('drop(id, reason) transitions exactly one item and leaves others untouched', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 5 });
    const a = store.add(fp(0)).item;
    const b = store.add(fp(1)).item;

    store.drop(a.id, 'stale');

    const items = store.getItems();
    expect(items.find((i) => i.id === a.id).status).toBe('failed');
    expect(items.find((i) => i.id === a.id).reason).toBe('stale');
    expect(items.find((i) => i.id === b.id).status).toBe('queued');
    expect(store.pendingCount()).toBe(1);
  });

  it('getItems() returns a shallow copy, never the live internal array', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 5 });
    store.add(fp(0));
    const items = store.getItems();
    items.push({ id: 'intruder', status: 'queued' });
    expect(store.getItems()).toHaveLength(1);
  });

  it('onChange(cb) fires after every mutating call; offChange(cb) stops further notifications', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 5 });
    const cb = vi.fn();
    store.onChange(cb);

    const a = store.add(fp(0)).item;
    expect(cb).toHaveBeenCalledTimes(1);

    store.markRunning(a.id);
    expect(cb).toHaveBeenCalledTimes(2);

    store.offChange(cb);
    store.markDone(a.id);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('setMaxQueueSize(n) changes what getMaxQueueSize() returns and what add() enforces on the very next call', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 2 });
    store.add(fp(0));
    store.add(fp(1));
    expect(store.getMaxQueueSize()).toBe(2);

    const blocked = store.add(fp(2));
    expect(blocked).toEqual({ ok: false, reason: 'max' });

    store.setMaxQueueSize(3);
    expect(store.getMaxQueueSize()).toBe(3);

    const allowed = store.add(fp(2));
    expect(allowed.ok).toBe(true);
    expect(store.getItems()).toHaveLength(3);
  });

  it('setMaxQueueSize(25) is still re-clamped against HARD_MAX_QUEUE, same as the constructor path', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 5 });
    store.setMaxQueueSize(25);
    expect(store.getMaxQueueSize()).toBe(HARD_MAX_QUEUE);
  });

  it('setMaxQueueSize(n) fires onChange listeners; a non-finite n silently no-ops', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 5 });
    const cb = vi.fn();
    store.onChange(cb);

    store.setMaxQueueSize(10);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(store.getMaxQueueSize()).toBe(10);

    store.setMaxQueueSize(NaN);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(store.getMaxQueueSize()).toBe(10);

    store.offChange(cb);
  });

  it('requeue(id) flips running back to queued and notifies once; other statuses and unknown ids no-op', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 5 });
    const a = store.add(fp()).item;
    const b = store.add(fp()).item;
    store.markRunning(a.id);
    store.markDone(b.id);
    const cb = vi.fn();
    store.onChange(cb);

    store.requeue(a.id);
    expect(a.status).toBe('queued');
    expect(cb).toHaveBeenCalledTimes(1);

    store.requeue(b.id);
    store.requeue('nope');
    store.requeue(a.id);
    expect(b.status).toBe('done');
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('store clear / refingerprintAll / onReset', () => {
  it('clear fails queued and running items with the reason, notifies once, returns count', () => {
    const store = createStore({ bridge: makeFakeBridge() });
    const a = store.add({ mesId: 1 }).item;
    const b = store.add({ mesId: 1 }).item;
    const c = store.add({ mesId: 1 }).item;
    store.markRunning(a.id);
    store.markDone(c.id);
    const cb = vi.fn();
    const reset = vi.fn();
    store.onChange(cb);
    store.onReset(reset);

    expect(store.clear('edited')).toBe(2);
    expect(a.status).toBe('failed');
    expect(a.reason).toBe('edited');
    expect(b.status).toBe('failed');
    expect(c.status).toBe('done');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(store.getItems()).toHaveLength(3);
  });

  it('clear with nothing active returns 0 without notifying or resetting', () => {
    const store = createStore({ bridge: makeFakeBridge() });
    const cb = vi.fn();
    const reset = vi.fn();
    store.onChange(cb);
    store.onReset(reset);
    expect(store.clear('x')).toBe(0);
    expect(cb).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it('offReset removes a reset listener', () => {
    const store = createStore({ bridge: makeFakeBridge() });
    store.add({ mesId: 1 });
    const reset = vi.fn();
    store.onReset(reset);
    store.offReset(reset);
    store.clear('x');
    expect(reset).not.toHaveBeenCalled();
  });

  it('refingerprintAll mutates fingerprints in place for queued/running only, one notify', () => {
    const store = createStore({ bridge: makeFakeBridge() });
    const fpA = { mesId: 1, swipe0Hash: 'old' };
    const a = store.add(fpA).item;
    const b = store.add({ mesId: 1, swipe0Hash: 'old' }).item;
    const c = store.add({ mesId: 1, swipe0Hash: 'old' }).item;
    store.markRunning(a.id);
    store.markDone(c.id);
    const cb = vi.fn();
    store.onChange(cb);

    store.refingerprintAll({ swipe0Hash: 'new' });

    expect(a.fingerprint).toBe(fpA);
    expect(fpA.swipe0Hash).toBe('new');
    expect(b.fingerprint.swipe0Hash).toBe('new');
    expect(c.fingerprint.swipe0Hash).toBe('old');
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('chat-bound persistence', () => {
  function persistBridge(overrides = {}) {
    const meta = { integrity: 'int-1' };
    const c = {
      chatId: 'chat-1',
      chat: [{ name: 'Bot', mes: 'hi' }],
      chatMetadata: meta,
      saveChat: vi.fn(),
      saveMetadataDebounced: vi.fn(),
      ...overrides,
    };
    return { c, meta, bridge: { ctx: () => c, chatKey: () => 'av/chat-1' } };
  }

  it('is inert when unbound', () => {
    const { c, meta, bridge } = persistBridge();
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.add(fp(0));
    expect(c.saveChat).not.toHaveBeenCalled();
    expect(meta.queuedSwipes).toBeUndefined();
  });

  it('add() writes metadata and saves immediately', () => {
    const { c, meta, bridge } = persistBridge();
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.bindChat('av/chat-1', 'int-1');
    store.add(fp(0));
    expect(c.saveChat).toHaveBeenCalledTimes(1);
    expect(meta.queuedSwipes.items).toHaveLength(1);
  });

  it('drop() uses the debounced save and deletes the key when empty', () => {
    const { c, meta, bridge } = persistBridge();
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.bindChat('av/chat-1', 'int-1');
    const { item } = store.add(fp(0));
    store.drop(item.id, 'api');
    expect(c.saveMetadataDebounced).toHaveBeenCalledTimes(1);
    expect(meta.queuedSwipes).toBeUndefined();
  });

  it('refuses on key mismatch, empty chat, or integrity mismatch', () => {
    const a = persistBridge();
    const s1 = createStore({ bridge: { ...a.bridge, chatKey: () => 'other/chat' }, maxQueueSize: 5 });
    s1.bindChat('av/chat-1', 'int-1');
    s1.add(fp(0));
    expect(a.c.saveChat).not.toHaveBeenCalled();

    const b = persistBridge({ chat: [] });
    const s2 = createStore({ bridge: b.bridge, maxQueueSize: 5 });
    s2.bindChat('av/chat-1', 'int-1');
    s2.add(fp(0));
    expect(b.c.saveChat).not.toHaveBeenCalled();

    const d = persistBridge();
    const s3 = createStore({ bridge: d.bridge, maxQueueSize: 5 });
    s3.bindChat('av/chat-1', 'int-OTHER');
    s3.add(fp(0));
    expect(d.c.saveChat).not.toHaveBeenCalled();
    expect(d.meta.queuedSwipes).toBeUndefined();
  });

  it('swallows saveChat errors', () => {
    const { bridge } = persistBridge({ saveChat: vi.fn(() => { throw new Error('boom'); }) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.bindChat('av/chat-1', 'int-1');
    expect(store.add(fp(0)).ok).toBe(true);
    warn.mockRestore();
  });

  it('persistExcluding writes without saving', () => {
    const { c, meta, bridge } = persistBridge();
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.bindChat('av/chat-1', 'int-1');
    const a = store.add(fp(0)).item;
    store.add(fp(0));
    c.saveChat.mockClear();
    store.persistExcluding(a.id);
    expect(meta.queuedSwipes.items).toHaveLength(1);
    expect(c.saveChat).not.toHaveBeenCalled();
    expect(c.saveMetadataDebounced).not.toHaveBeenCalled();
  });

  it('rebind replaces items, notifies once, fires onReset, never persists', () => {
    const { c, bridge } = persistBridge();
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.bindChat('av/chat-1', 'int-1');
    const change = vi.fn();
    const reset = vi.fn();
    store.onChange(change);
    store.onReset(reset);
    store.rebind([{ id: 'x', status: 'queued', fingerprint: fp(0) }]);
    expect(change).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(store.getItems().map((i) => i.id)).toEqual(['x']);
    expect(c.saveChat).not.toHaveBeenCalled();
    expect(c.saveMetadataDebounced).not.toHaveBeenCalled();
  });
});

describe('store connection recording', () => {
  it('add() records a copied connection snapshot', () => {
    const snap = { api: 'openai', model: 'm1', preset: 'p1' };
    const bridge = { ...makeFakeBridge(), connectionSnapshot: () => snap };
    const store = createStore({ bridge, maxQueueSize: 5 });
    const { item } = store.add(fp());
    expect(item.connection).toEqual(snap);
    expect(item.connection).not.toBe(snap);
  });

  it('add() leaves connection null when the bridge has no connectionSnapshot', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 5 });
    expect(store.add(fp()).item.connection).toBeNull();
  });

  it('setConnectionAll() updates active items only, notifies once and persists', () => {
    const save = vi.fn();
    const bridge = {
      ...makeFakeBridge(),
      chatKey: () => 'k',
      ctx: () => ({ chat: [{}], chatMetadata: { integrity: 'i' }, saveChat: vi.fn(), saveMetadataDebounced: save }),
    };
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.bindChat('k', 'i');
    const a = store.add(fp(0)).item;
    const b = store.add(fp(0)).item;
    const c = store.add(fp(0)).item;
    store.markDone(c.id);
    store.drop(b.id, 'api');
    const cb = vi.fn();
    store.onChange(cb);
    save.mockClear();
    const snap = { api: 'x', model: 'y', preset: 'z' };
    store.setConnectionAll(snap);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    const items = store.getItems();
    expect(items.find((i) => i.id === a.id).connection).toEqual(snap);
    expect(items.find((i) => i.id === a.id).connection).not.toBe(snap);
    expect(items.find((i) => i.id === b.id).connection).toBeNull();
    expect(items.find((i) => i.id === c.id).connection).toBeNull();
  });
});

describe('store read-only mode', () => {
  it('refuses add() and persists nothing while read-only', () => {
    const meta = { integrity: 'int-1' };
    const c = {
      chatId: 'chat-1',
      chat: [{ name: 'Bot', mes: 'hi' }],
      chatMetadata: meta,
      saveChat: vi.fn(),
      saveMetadataDebounced: vi.fn(),
    };
    const bridge = { ctx: () => c, chatKey: () => 'av/chat-1' };
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.bindChat('av/chat-1', 'int-1');
    const { item } = store.add(fp(0));
    c.saveChat.mockClear();
    delete meta.queuedSwipes;

    store.setReadOnly(true);
    expect(store.isReadOnly()).toBe(true);
    expect(store.add(fp(0))).toEqual({ ok: false, reason: 'readonly' });
    store.persist({ immediate: true });
    store.persistExcluding(item.id);
    store.markDone(item.id);
    expect(c.saveChat).not.toHaveBeenCalled();
    expect(c.saveMetadataDebounced).not.toHaveBeenCalled();
    expect(meta.queuedSwipes).toBeUndefined();

    store.setReadOnly(false);
    expect(store.add(fp(0)).ok).toBe(true);
  });

  it('notifies listeners when the flag changes', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 5 });
    const cb = vi.fn();
    store.onChange(cb);
    store.setReadOnly(true);
    store.setReadOnly(true);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
