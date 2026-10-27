import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFingerprint } from '../src/fingerprint.js';
import { createStore } from '../src/store.js';
import { createRunner } from '../src/runner.js';

// adapter.js imports st-bridge.js, which imports ST's own script.js via a relative path that
// only resolves once this extension is deployed inside a live ST install — unresolvable under
// plain Node/Vitest. Mock adapter.js so the test graph never touches st-bridge.js, while still
// faithfully exercising abortRunning()'s delegation: abort the controller, report its signal
// state, exactly like the real abortOwn(ownController) in src/adapter.js.
vi.mock('../src/adapter.js', () => ({
  abortOwn: vi.fn(async (ownController) => {
    ownController.abort();
    return { aborted: ownController.signal.aborted };
  }),
}));

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

  it('fires onItemFailed({id, reason}) subscribers when an item is dropped for a non-stale reason', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const item = store.add(buildFingerprint(ctx, 0)).item;

    const generate = vi.fn().mockRejectedValue(new Error('api down'));
    const append = vi.fn();
    const runner = createRunner({ bridge, store, generate, append });
    const onFailed = vi.fn();
    runner.onItemFailed(onFailed);

    await runner.wake();

    expect(onFailed).toHaveBeenCalledWith({ id: item.id, reason: 'api down' });
  });

  it('does NOT fire onItemFailed when an item is dropped as stale (GUARD-04 silent target-safety discard, not a GUARD-05 user-facing failure)', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.add(buildFingerprint(ctx, 0));
    ctx.chat[0].mes = 'edited'; // invalidate so the pre-capture stale-drop path fires

    const generate = vi.fn();
    const append = vi.fn();
    const runner = createRunner({ bridge, store, generate, append });
    const onFailed = vi.fn();
    runner.onItemFailed(onFailed);

    await runner.wake();

    expect(onFailed).not.toHaveBeenCalled();
  });

  it('drops the item at the second (pre-append) fingerprint checkpoint and never calls append(), even though the pre-capture check passed', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const item = store.add(buildFingerprint(ctx, 0)).item;

    // Simulate the target being edited while generate() was in flight: the pre-capture check
    // (before generate() is called) already passed, so this must be caught by the second,
    // independent check immediately before append().
    const generate = vi.fn(async () => {
      ctx.chat[0].mes = 'edited mid-generation';
      return { text: 'generated text', meta: {} };
    });
    const append = vi.fn();
    const onFailed = vi.fn();
    const runner = createRunner({ bridge, store, generate, append });
    runner.onItemFailed(onFailed);

    await runner.wake();

    expect(append).not.toHaveBeenCalled();
    expect(store.getItems().find((i) => i.id === item.id)).toMatchObject({ status: 'failed', reason: 'stale' });
    expect(onFailed).not.toHaveBeenCalled(); // stale drops never fire onItemFailed (GUARD-05)
  });

  it('pause() makes wake() a no-op (no generate() call) even when items are pending', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.add(buildFingerprint(ctx, 0));

    const generate = vi.fn();
    const append = vi.fn();
    const runner = createRunner({ bridge, store, generate, append });

    runner.pause('native');
    await runner.wake();

    expect(generate).not.toHaveBeenCalled();
  });

  it('resume() clears the paused flag and processes a pending item', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const item = store.add(buildFingerprint(ctx, 0)).item;

    const generate = vi.fn().mockResolvedValue({ text: 'generated', meta: {} });
    const append = vi.fn().mockResolvedValue('ok');
    const runner = createRunner({ bridge, store, generate, append });

    runner.pause('native');
    await runner.wake();
    expect(generate).not.toHaveBeenCalled();

    await runner.resume();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(store.getItems().find((i) => i.id === item.id).status).toBe('done');
  });

  it('pause() does not abort an item already mid-generate(); the current item still completes, but no further item starts until resume()', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const first = store.add(buildFingerprint(ctx, 0)).item;
    const second = store.add(buildFingerprint(ctx, 0)).item;

    let resolveFirst;
    const generate = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ text: 'second text', meta: {} });
    const append = vi.fn().mockResolvedValue('ok');
    const runner = createRunner({ bridge, store, generate, append });

    const wakePromise = runner.wake();
    runner.pause('native'); // fires mid-flight, while the first item's generate() is pending

    resolveFirst({ text: 'first text', meta: {} });
    await wakePromise;

    expect(generate).toHaveBeenCalledTimes(1); // only the first item ran; pause blocked the second
    expect(store.getItems().find((i) => i.id === first.id).status).toBe('done');
    expect(store.getItems().find((i) => i.id === second.id).status).toBe('queued');

    await runner.resume();

    expect(generate).toHaveBeenCalledTimes(2);
    expect(store.getItems().find((i) => i.id === second.id).status).toBe('done');
  });

  it.each([
    ['api', 'a thrown error from adapter.capture()/send(), normalized by the real generate() wrapper'],
    ['empty', 'a resolved-but-unsuccessful adapter result where sent.aborted is false'],
    ['cancelled', 'a resolved-but-unsuccessful adapter result where sent.aborted is true'],
  ])('drops the item with reason %s and continues to the next item without throwing (%s)', async (reason) => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const failingItem = store.add(buildFingerprint(ctx, 0)).item;
    const okItem = store.add(buildFingerprint(ctx, 0)).item;

    const generate = vi.fn()
      .mockResolvedValueOnce({ error: reason })
      .mockResolvedValueOnce({ text: 'ok text', meta: {} });
    const append = vi.fn().mockResolvedValue('ok');
    const runner = createRunner({ bridge, store, generate, append });

    await runner.wake();

    expect(store.getItems().find((i) => i.id === failingItem.id)).toMatchObject({ status: 'failed', reason });
    expect(store.getItems().find((i) => i.id === okItem.id)).toMatchObject({ status: 'done' });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('offItemFailed(cb) stops further notifications', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.add(buildFingerprint(ctx, 0));

    const generate = vi.fn().mockRejectedValue(new Error('boom'));
    const append = vi.fn();
    const runner = createRunner({ bridge, store, generate, append });
    const onFailed = vi.fn();
    runner.onItemFailed(onFailed);
    runner.offItemFailed(onFailed);

    await runner.wake();

    expect(onFailed).not.toHaveBeenCalled();
  });

  it('abortRunning() returns { aborted: false } when no item is currently mid-generate()', () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });

    const generate = vi.fn();
    const append = vi.fn();
    const runner = createRunner({ bridge, store, generate, append });

    expect(runner.abortRunning()).toEqual({ aborted: false });
  });

  it('abortRunning() aborts the in-flight generate() signal while an item is running, and the aborted item is dropped with reason "cancelled" once generate() resolves accordingly', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const item = store.add(buildFingerprint(ctx, 0)).item;

    let receivedSignal;
    let resolveGenerate;
    const generate = vi.fn((_item, { signal } = {}) => {
      receivedSignal = signal;
      return new Promise((resolve) => { resolveGenerate = resolve; });
    });
    const append = vi.fn();
    const runner = createRunner({ bridge, store, generate, append });

    const wakePromise = runner.wake();
    // Let processNext() reach the generate() call and set up runningController.
    await Promise.resolve();
    await Promise.resolve();

    const { aborted } = await runner.abortRunning();

    expect(aborted).toBe(true);
    expect(receivedSignal).toBeDefined();
    expect(receivedSignal.aborted).toBe(true);

    resolveGenerate({ error: 'cancelled' });
    await wakePromise;

    expect(store.getItems().find((i) => i.id === item.id)).toMatchObject({ status: 'failed', reason: 'cancelled' });
  });

  it('generate() is called with { signal } sourced from a fresh per-item AbortController owned by the runner', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.add(buildFingerprint(ctx, 0));

    const generate = vi.fn().mockResolvedValue({ text: 'ok', meta: {} });
    const append = vi.fn().mockResolvedValue('ok');
    const runner = createRunner({ bridge, store, generate, append });

    await runner.wake();

    expect(generate).toHaveBeenCalledTimes(1);
    const [, opts] = generate.mock.calls[0];
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(opts.signal.aborted).toBe(false);
  });

  it('onItemDone(cb) fires { id } immediately after store.markDone(), and offItemDone(cb) stops further notifications', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const item = store.add(buildFingerprint(ctx, 0)).item;

    const generate = vi.fn().mockResolvedValue({ text: 'ok', meta: {} });
    const append = vi.fn().mockResolvedValue('ok');
    const runner = createRunner({ bridge, store, generate, append });
    const onDone = vi.fn();
    runner.onItemDone(onDone);

    await runner.wake();

    expect(onDone).toHaveBeenCalledWith({ id: item.id });
    expect(store.getItems().find((i) => i.id === item.id).status).toBe('done');

    onDone.mockClear();
    runner.offItemDone(onDone);

    const second = store.add(buildFingerprint(ctx, 0)).item;
    await runner.wake();

    expect(store.getItems().find((i) => i.id === second.id).status).toBe('done');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('onItemDone(cb) does NOT fire when an item fails or is dropped as stale', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.add(buildFingerprint(ctx, 0));

    const generate = vi.fn().mockRejectedValue(new Error('boom'));
    const append = vi.fn();
    const runner = createRunner({ bridge, store, generate, append });
    const onDone = vi.fn();
    runner.onItemDone(onDone);

    await runner.wake();

    expect(onDone).not.toHaveBeenCalled();
  });
});
