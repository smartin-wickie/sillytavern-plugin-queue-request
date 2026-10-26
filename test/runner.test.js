import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFingerprint } from '../src/fingerprint.js';
import { createStore } from '../src/store.js';
import { createRunner } from '../src/runner.js';

function makeCtx(overrides = {}) {
  return {
    chatId: 'chat-1',
    chatMetadata: { integrity: null },
    chat: [{ mes: 'hello', name: 'Bot', is_user: false }],
    ...overrides,
  };
}

function makeBridge(ctx, { generating = false, swipeState = 'none' } = {}) {
  return {
    ctx: () => ctx,
    isGenerating: () => generating,
    swipeState: () => swipeState,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createRunner', () => {
  it('wake() does nothing (no generate() call) while bridge.isGenerating() is true', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx, { generating: true });
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.add(buildFingerprint(ctx, 0));

    const generate = vi.fn();
    const append = vi.fn();
    const runner = createRunner({ bridge, store, generate, append });

    await runner.wake();

    expect(generate).not.toHaveBeenCalled();
  });

  it('wake() does nothing (no generate() call) while bridge.swipeState() !== "none"', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx, { swipeState: 'swiped' });
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.add(buildFingerprint(ctx, 0));

    const generate = vi.fn();
    const append = vi.fn();
    const runner = createRunner({ bridge, store, generate, append });

    await runner.wake();

    expect(generate).not.toHaveBeenCalled();
  });

  it('never has two generate() calls in flight; a concurrent wake() is a no-op until the first completes', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.add(buildFingerprint(ctx, 0));

    let resolveGenerate;
    const generate = vi.fn(() => new Promise((resolve) => { resolveGenerate = resolve; }));
    const append = vi.fn().mockResolvedValue('ok');
    const runner = createRunner({ bridge, store, generate, append });

    const firstWake = runner.wake();
    const secondWake = runner.wake(); // fired while the first item is already running
    await secondWake;

    expect(generate).toHaveBeenCalledTimes(1);

    resolveGenerate({ text: 'hello', meta: {} });
    await firstWake;

    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('drops a stale item without calling generate() for it, then immediately tries the next item', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });

    const staleItem = store.add(buildFingerprint(ctx, 0)).item;
    // Invalidate the target after capturing the first fingerprint, then build a second,
    // currently-matching fingerprint for the next item.
    ctx.chat[0].mes = 'edited';
    const freshItem = store.add(buildFingerprint(ctx, 0)).item;

    const generate = vi.fn().mockResolvedValue({ text: 'ok text', meta: {} });
    const append = vi.fn().mockResolvedValue('ok');
    const runner = createRunner({ bridge, store, generate, append });

    await runner.wake();

    expect(store.getItems().find((i) => i.id === staleItem.id)).toMatchObject({ status: 'failed', reason: 'stale' });
    expect(store.getItems().find((i) => i.id === freshItem.id)).toMatchObject({ status: 'done' });
    expect(generate).toHaveBeenCalledTimes(1); // only for the fresh item
  });

  it('on generate() success, appends the result and marks the item done', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const item = store.add(buildFingerprint(ctx, 0)).item;

    const meta = { started: new Date() };
    const generate = vi.fn().mockResolvedValue({ text: 'generated text', meta });
    const append = vi.fn().mockResolvedValue('ok');
    const runner = createRunner({ bridge, store, generate, append });

    await runner.wake();

    expect(append).toHaveBeenCalledWith(0, 'generated text', meta);
    expect(store.getItems().find((i) => i.id === item.id).status).toBe('done');
  });

  it('retries an append that returns "defer" on a short poll instead of dropping the item (park-then-flush)', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const item = store.add(buildFingerprint(ctx, 0)).item;

    const generate = vi.fn().mockResolvedValue({ text: 'generated', meta: {} });
    const append = vi.fn()
      .mockResolvedValueOnce('defer')
      .mockResolvedValueOnce('defer')
      .mockResolvedValueOnce('ok');
    const runner = createRunner({ bridge, store, generate, append });

    const wakePromise = runner.wake();
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(250);
    await wakePromise;

    expect(append).toHaveBeenCalledTimes(3);
    expect(store.getItems().find((i) => i.id === item.id).status).toBe('done');
  });

  it('drops the item and discards the generated text when append() returns "stale"', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const item = store.add(buildFingerprint(ctx, 0)).item;

    const generate = vi.fn().mockResolvedValue({ text: 'generated', meta: {} });
    const append = vi.fn().mockResolvedValue('stale');
    const runner = createRunner({ bridge, store, generate, append });

    await runner.wake();

    expect(append).toHaveBeenCalledTimes(1);
    expect(store.getItems().find((i) => i.id === item.id)).toMatchObject({ status: 'failed', reason: 'stale' });
  });

  it('drops the item and continues, without throwing out of wake(), when generate() rejects', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const item = store.add(buildFingerprint(ctx, 0)).item;

    const generate = vi.fn().mockRejectedValue(new Error('api down'));
    const append = vi.fn();
    const runner = createRunner({ bridge, store, generate, append });

    await runner.wake();

    expect(append).not.toHaveBeenCalled();
    expect(store.getItems().find((i) => i.id === item.id)).toMatchObject({ status: 'failed', reason: 'api down' });
  });

  it('drops the item and continues when generate() resolves with a typed error object', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const item = store.add(buildFingerprint(ctx, 0)).item;

    const generate = vi.fn().mockResolvedValue({ error: 'empty' });
    const append = vi.fn();
    const runner = createRunner({ bridge, store, generate, append });

    await runner.wake();

    expect(append).not.toHaveBeenCalled();
    expect(store.getItems().find((i) => i.id === item.id)).toMatchObject({ status: 'failed', reason: 'empty' });
  });

  it('fires onItemFailed({id, reason}) subscribers when an item is dropped', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const item = store.add(buildFingerprint(ctx, 0)).item;
    ctx.chat[0].mes = 'edited'; // invalidate so the drop path fires

    const generate = vi.fn();
    const append = vi.fn();
    const runner = createRunner({ bridge, store, generate, append });
    const onFailed = vi.fn();
    runner.onItemFailed(onFailed);

    await runner.wake();

    expect(onFailed).toHaveBeenCalledWith({ id: item.id, reason: 'stale' });
  });

  it('offItemFailed(cb) stops further notifications', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.add(buildFingerprint(ctx, 0));
    ctx.chat[0].mes = 'edited';

    const generate = vi.fn();
    const append = vi.fn();
    const runner = createRunner({ bridge, store, generate, append });
    const onFailed = vi.fn();
    runner.onItemFailed(onFailed);
    runner.offItemFailed(onFailed);

    await runner.wake();

    expect(onFailed).not.toHaveBeenCalled();
  });
});
