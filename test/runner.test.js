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

  it('pause() does not abort an item mid-generate(); its result is parked until resume, then appended, and no further item starts before that', async () => {
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
    await vi.advanceTimersByTimeAsync(1000);
    expect(append).not.toHaveBeenCalled(); // parked while 'native' is set
    expect(store.getItems().find((i) => i.id === first.id).status).toBe('running');

    runner.resume('native');
    await vi.advanceTimersByTimeAsync(300);
    await wakePromise;

    expect(generate).toHaveBeenCalledTimes(2);
    expect(store.getItems().find((i) => i.id === first.id).status).toBe('done');
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

  it('onItemDone(cb) fires { id } and the item ends up done in the store, and offItemDone(cb) stops further notifications', async () => {
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

  it('reason isolation: resume("native") leaves other pause reasons; resume() and resumeAll() clear all', () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const runner = createRunner({ bridge, store, generate: vi.fn(), append: vi.fn() });

    runner.pause('native');
    runner.pause('failures');
    runner.resume('native');
    expect(runner.isPaused()).toBe(true);
    expect(runner.getPauseReasons()).toEqual(['failures']);

    runner.pause('takeover');
    expect(runner.getPrimaryReason()).toBe('takeover');
    runner.resume();
    expect(runner.isPaused()).toBe(false);
    expect(runner.getPrimaryReason()).toBeNull();

    runner.pause('inspector');
    runner.pause('connection');
    expect(runner.getPrimaryReason()).toBe('inspector');
    runner.resumeAll();
    expect(runner.getPauseReasons()).toEqual([]);
  });

  it('onStateChange fires only on actual reason-set changes; offStateChange removes', () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const runner = createRunner({ bridge, store, generate: vi.fn(), append: vi.fn() });
    const cb = vi.fn();
    runner.onStateChange(cb);

    runner.pause('native');
    runner.pause('native');
    expect(cb).toHaveBeenCalledTimes(1);
    runner.resume('failures');
    expect(cb).toHaveBeenCalledTimes(1);
    runner.resume('native');
    expect(cb).toHaveBeenCalledTimes(2);
    runner.offStateChange(cb);
    runner.pause('native');
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('parks a finished result until the bridge is idle, then appends', async () => {
    const ctx = makeCtx();
    let generating = false;
    const bridge = { ctx: () => ctx, isGenerating: () => generating, swipeState: () => 'none' };
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.add(buildFingerprint(ctx, 0));
    const generate = vi.fn(async () => {
      generating = true; // a native generation starts while ours finishes
      return { text: 't', meta: {} };
    });
    const append = vi.fn().mockResolvedValue('ok');
    const runner = createRunner({ bridge, store, generate, append });

    const p = runner.wake();
    await vi.advanceTimersByTimeAsync(1000);
    expect(append).not.toHaveBeenCalled();
    generating = false;
    await vi.advanceTimersByTimeAsync(300);
    await p;
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('Continue case: fingerprint changes while parked under "native"; result is not dropped and appends after re-fingerprint + resume("native")', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const item = store.add(buildFingerprint(ctx, 0)).item;
    const generate = vi.fn(async () => ({ text: 'queued text', meta: {} }));
    const append = vi.fn().mockResolvedValue('ok');
    const runner = createRunner({ bridge, store, generate, append });

    const p = runner.wake();
    runner.pause('native'); // lands while generate() is in flight
    ctx.chat[0].mes = 'hello continued'; // native Continue edits the swipe-0 text
    await vi.advanceTimersByTimeAsync(1000);
    expect(append).not.toHaveBeenCalled();
    expect(store.getItems().find((i) => i.id === item.id).status).toBe('running');

    // onNativeEnd: re-fingerprint the live item, then release 'native'
    item.fingerprint = buildFingerprint(ctx, 0);
    runner.resume('native');
    await vi.advanceTimersByTimeAsync(300);
    await p;
    expect(append).toHaveBeenCalledTimes(1);
    expect(store.getItems().find((i) => i.id === item.id).status).toBe('done');
  });

  it('invalidate() during generate discards silently: no append, no failure notification', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const item = store.add(buildFingerprint(ctx, 0)).item;
    let runner;
    const generate = vi.fn(async () => {
      runner.invalidate();
      return { text: 't', meta: {} };
    });
    const append = vi.fn();
    runner = createRunner({ bridge, store, generate, append });
    const onFailed = vi.fn();
    runner.onItemFailed(onFailed);

    await runner.wake();

    expect(append).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
    expect(store.getItems().find((i) => i.id === item.id)).toMatchObject({ status: 'failed', reason: 'stale' });
  });

  it('invalidate() while parked discards silently', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    store.add(buildFingerprint(ctx, 0));
    const generate = vi.fn(async () => ({ text: 't', meta: {} }));
    const append = vi.fn();
    const runner = createRunner({ bridge, store, generate, append });
    const onFailed = vi.fn();
    runner.onItemFailed(onFailed);

    const p = runner.wake();
    runner.pause('native');
    await vi.advanceTimersByTimeAsync(500);
    runner.invalidate();
    runner.resume('native');
    await vi.advanceTimersByTimeAsync(300);
    await p;

    expect(append).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
  });

  async function runAbort(disposition) {
    const ctx = makeCtx();
    const stopGeneration = vi.fn();
    const bridge = { ...makeBridge(ctx), stopGeneration };
    const store = createStore({ bridge, maxQueueSize: 5 });
    const item = store.add(buildFingerprint(ctx, 0)).item;
    let resolveGenerate;
    const generate = vi.fn(() => new Promise((resolve) => { resolveGenerate = resolve; }));
    const runner = createRunner({ bridge, store, generate, append: vi.fn() });
    const onFailed = vi.fn();
    runner.onItemFailed(onFailed);

    const p = runner.wake();
    await Promise.resolve();
    await Promise.resolve();
    await runner.abortRunning({ disposition });
    resolveGenerate({ error: 'cancelled' });
    await p;
    return { store, item, onFailed, stopGeneration };
  }

  it('abortRunning({ disposition: "requeue" }) returns the item to queued with no failure notification and never calls stopGeneration', async () => {
    const { store, item, onFailed, stopGeneration } = await runAbort('requeue');
    expect(store.getItems().find((i) => i.id === item.id).status).toBe('queued');
    expect(onFailed).not.toHaveBeenCalled();
    expect(stopGeneration).not.toHaveBeenCalled();
  });

  it('abortRunning({ disposition: "discard" }) drops silently without notifying', async () => {
    const { store, item, onFailed } = await runAbort('discard');
    expect(store.getItems().find((i) => i.id === item.id).status).toBe('failed');
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('chat identity mismatch before start pauses "restored" and leaves items queued, generating nothing', async () => {
    const ctx = makeCtx();
    const bridge = makeBridge(ctx);
    const store = createStore({ bridge, maxQueueSize: 5 });
    const item = store.add(buildFingerprint(ctx, 0)).item;
    ctx.chatId = 'chat-2';
    const generate = vi.fn();
    const runner = createRunner({ bridge, store, generate, append: vi.fn() });

    await runner.wake();

    expect(generate).not.toHaveBeenCalled();
    expect(runner.getPauseReasons()).toEqual(['restored']);
    expect(store.getItems().find((i) => i.id === item.id).status).toBe('queued');
  });
});
