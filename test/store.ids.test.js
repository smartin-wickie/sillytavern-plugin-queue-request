// CR-03: item ids on origins without crypto.randomUUID (plain-HTTP LAN access). Each test
// re-imports store.js after vi.resetModules() to simulate a page reload: module state (any
// fallback counter) starts over, while restored items keep the ids of the previous load.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { hash } from '../src/fingerprint.js';
import { loadStored, serialize } from '../src/persistence.js';

function fp() {
  return { chatId: 'c1', integrity: 'i1', mesId: 1, chatLength: 2, swipe0Hash: hash('hello'), name: 'Bot' };
}

async function freshStoreModule() {
  vi.resetModules();
  return import('../src/store.js');
}

function addMany(createStore, n) {
  const store = createStore({ bridge: { ctx: () => ({ chat: [] }) }, maxQueueSize: 20 });
  for (let i = 0; i < n; i += 1) store.add(fp());
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe.each([
  ['getRandomValues only', () => ({ getRandomValues: (a) => webcrypto.getRandomValues(a) })],
  ['no crypto at all', () => undefined],
])('item ids without crypto.randomUUID (%s)', (_label, makeCrypto) => {
  it('stay unique across a simulated page reload with restored items', async () => {
    vi.stubGlobal('crypto', makeCrypto());
    const first = await freshStoreModule();
    const before = addMany(first.createStore, 3).getItems().map((i) => i.id);

    const second = await freshStoreModule();
    const store = second.createStore({ bridge: { ctx: () => ({ chat: [] }) }, maxQueueSize: 20 });
    store.rebind(before.map((id) => ({ id, status: 'done', attempts: 0, fingerprint: fp() })));
    for (let i = 0; i < 3; i += 1) store.add(fp());
    const ids = store.getItems().map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('id-collision guards', () => {
  it('markRunning refuses an item that is not queued', async () => {
    const { createStore } = await freshStoreModule();
    const store = addMany(createStore, 1);
    const [a] = store.getItems();
    store.markRunning(a.id);
    store.markDone(a.id);
    store.markRunning(a.id);
    expect(store.getItems()[0].status).toBe('done');
  });

  it('loadStored drops duplicate ids', () => {
    const chat = [
      { name: 'u', mes: 'hi', is_user: true },
      { name: 'Bot', mes: 'hello', swipes: ['hello'] },
    ];
    const ctx = { chatId: 'c1', chat, chatMetadata: { integrity: 'i1' } };
    const now = Date.now();
    const item = (id) => ({ id, status: 'queued', createdAt: now - 1000, fingerprint: fp(), connection: {} });
    const blob = serialize([item('x'), item('x'), item('y')]);
    const result = loadStored(blob, ctx, now);
    expect(result.items.map((i) => i.id)).toEqual(['x', 'y']);
    expect(result.dropped).toBe(1);
  });
});
