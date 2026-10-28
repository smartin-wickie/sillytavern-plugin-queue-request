import { describe, expect, it, vi } from 'vitest';
import { buildSnapshot, loadStored, parseSnapshot } from '../src/persistence.js';
import { hash } from '../src/fingerprint.js';
import { createStore } from '../src/store.js';

describe('snapshot build/parse', () => {
  const item = (status, id = 'a') => ({
    id,
    status,
    createdAt: new Date(1000),
    fingerprint: { mesId: 1, chatLength: 2, swipe0Hash: 'h', name: 'Bot' },
    connection: { api: 'x', model: 'm', preset: null },
  });

  it('round-trips queued/running items and drops terminal ones', () => {
    const snap = buildSnapshot({
      items: [item('queued'), item('done', 'b'), item('running', 'c')],
      completed: 2,
      reasons: ['restored', 'bogus'],
      failures: 1,
    });
    expect(snap.items.map((i) => i.id)).toEqual(['a', 'c']);
    expect(snap.reasons).toEqual(['restored']);
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(parsed.items).toHaveLength(2);
    expect(parsed.completed).toBe(2);
    expect(parsed.items[0].createdAt).toBe(1000);
  });

  it('a built snapshot loads back through loadStored with its items (CR-01)', () => {
    const chat = [
      { name: 'u', mes: 'hi', is_user: true },
      { name: 'Bot', mes: 'hello', swipes: ['hello'] },
    ];
    const ctx = { chatId: 'c1', chat, chatMetadata: { integrity: 'i1' } };
    const fp = { mesId: 1, chatLength: 2, swipe0Hash: hash('hello'), name: 'Bot' };
    const now = Date.now();
    const snap = buildSnapshot({
      items: [
        { id: 'a', status: 'queued', createdAt: new Date(now - 1000), fingerprint: fp, connection: {} },
        { id: 'b', status: 'running', createdAt: new Date(now - 500), fingerprint: fp, connection: {} },
      ],
      completed: 0,
      reasons: [],
      failures: 0,
    });
    const result = loadStored(JSON.parse(JSON.stringify(snap)), ctx, now);
    expect(result.ignored).toBe(false);
    expect(result.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(parseSnapshot(snap)).not.toBeNull();
  });

  it('rejects invalid shapes and truncates to 20', () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot('x')).toBeNull();
    expect(parseSnapshot({ items: [], completed: 'a', reasons: [], failures: 0 })).toBeNull();
    expect(parseSnapshot({ items: [{ id: 1 }], completed: 0, reasons: [], failures: 0 })).toBeNull();
    expect(parseSnapshot({ items: [], completed: Infinity, reasons: [], failures: 0 })).toBeNull();
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `i${i}`, status: 'queued', createdAt: 1, target: {}, connection: {} }));
    expect(parseSnapshot({ items: many, completed: 0, reasons: ['nope', 'native'], failures: 0 }).items).toHaveLength(20);
    expect(parseSnapshot({ items: [], completed: 0, reasons: ['nope', 'native'], failures: 0 }).reasons).toEqual(['native']);
  });
});

describe('store completed counter and snapshot', () => {
  function bridgeWithCtx() {
    const c = { chat: [{}], chatMetadata: {}, saveChat: vi.fn(), saveMetadataDebounced: vi.fn() };
    return { ctx: () => c, chatKey: () => 'k', c };
  }
  const fp = () => ({ mesId: 0, chatLength: 1, swipe0Hash: 'h', name: 'B' });

  it('counts markDone and resets on a fresh add, rebind and clear', () => {
    const store = createStore({ bridge: bridgeWithCtx(), maxQueueSize: 5 });
    const a = store.add(fp()).item;
    store.markDone(a.id);
    expect(store.getCompleted()).toBe(1);
    const b = store.add(fp()).item;
    expect(store.getCompleted()).toBe(0);
    store.markDone(b.id);
    expect(store.getCompleted()).toBe(1);
    store.rebind([]);
    expect(store.getCompleted()).toBe(0);
    const c = store.add(fp()).item;
    store.markDone(c.id);
    store.add(fp());
    store.clear('x');
    expect(store.getCompleted()).toBe(0);
  });

  it('applySnapshot is ignored unless read-only and never persists', () => {
    const br = bridgeWithCtx();
    const store = createStore({ bridge: br, maxQueueSize: 5 });
    const snap = { items: [{ id: 'z', status: 'queued', createdAt: 5 }], completed: 3, reasons: ['native'], failures: 2 };
    store.applySnapshot(snap);
    expect(store.getItems()).toHaveLength(0);
    store.setReadOnly(true);
    store.applySnapshot(snap);
    expect(store.getItems()).toHaveLength(1);
    expect(store.pendingCount()).toBe(1);
    expect(store.getCompleted()).toBe(3);
    expect(store.getSnapshotStats()).toEqual({ reasons: ['native'], failures: 2, completed: 3 });
    expect(br.c.saveChat).not.toHaveBeenCalled();
    expect(br.c.saveMetadataDebounced).not.toHaveBeenCalled();
    expect(br.c.chatMetadata.queuedSwipes).toBeUndefined();
  });

  it('fires onReadOnlyChange only when the flag changes', () => {
    const store = createStore({ bridge: bridgeWithCtx(), maxQueueSize: 5 });
    const cb = vi.fn();
    store.onReadOnlyChange(cb);
    store.setReadOnly(true);
    store.setReadOnly(true);
    store.setReadOnly(false);
    expect(cb).toHaveBeenCalledTimes(2);
    store.offReadOnlyChange(cb);
    store.setReadOnly(true);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
