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
});
