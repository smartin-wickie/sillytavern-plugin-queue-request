import { describe, expect, it, vi } from 'vitest';
import { createStore } from '../src/store.js';
import { cancelAll, resumeQueue, enqueue, configureQueueActions } from '../src/queueActions.js';

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

describe('cancelAll', () => {
  it('returns 0 and calls store.drop zero times when nothing is queued or running', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 5 });
    const dropSpy = vi.spyOn(store, 'drop');
    const runner = { abortRunning: vi.fn().mockReturnValue({ aborted: false }) };

    const result = cancelAll(store, runner);

    expect(result).toBe(0);
    expect(dropSpy).not.toHaveBeenCalled();
    expect(runner.abortRunning).toHaveBeenCalledTimes(1);
  });

  it('drops every queued item and returns the pending count when nothing is running', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 5 });
    const a = store.add(fp(0)).item;
    const b = store.add(fp(1)).item;
    const runner = { abortRunning: vi.fn().mockReturnValue({ aborted: false }) };

    const result = cancelAll(store, runner);

    expect(result).toBe(2);
    expect(store.getItems().find((i) => i.id === a.id)).toMatchObject({ status: 'failed', reason: 'cancelled' });
    expect(store.getItems().find((i) => i.id === b.id)).toMatchObject({ status: 'failed', reason: 'cancelled' });
    expect(runner.abortRunning).toHaveBeenCalledTimes(1);
  });

  it('drops every queued item, aborts the running item, and returns pending.length + 1 when something is running', () => {
    const store = createStore({ bridge: makeFakeBridge(), maxQueueSize: 5 });
    const running = store.add(fp(0)).item;
    store.markRunning(running.id);
    const pendingA = store.add(fp(1)).item;
    const pendingB = store.add(fp(2)).item;
    const runner = { abortRunning: vi.fn().mockReturnValue({ aborted: true }) };

    const result = cancelAll(store, runner);

    expect(result).toBe(3); // 2 pending + 1 aborted running
    expect(store.getItems().find((i) => i.id === pendingA.id)).toMatchObject({ status: 'failed', reason: 'cancelled' });
    expect(store.getItems().find((i) => i.id === pendingB.id)).toMatchObject({ status: 'failed', reason: 'cancelled' });
    // cancelAll never drops the running item directly — that's runner.abortRunning()'s job,
    // which then flows through processNext()'s own error-handling drop path.
    expect(store.getItems().find((i) => i.id === running.id).status).toBe('running');
    expect(runner.abortRunning).toHaveBeenCalledTimes(1);
  });
});

function configure({ pi = false, chat = [{ mes: 'a', name: 'Bot', is_user: false }] } = {}) {
  const toast = { warning: vi.fn(), info: vi.fn() };
  const bridge = {
    ...makeFakeBridge(),
    ctx: () => ({ chatId: 'chat-1', chatMetadata: { integrity: null }, chat }),
    promptInspectorEnabled: () => pi,
  };
  configureQueueActions({ bridge, toast });
  return { bridge, toast };
}

describe('enqueue', () => {
  it('refuses with the locked toast and never touches the store while Prompt Inspector is on', () => {
    const { bridge, toast } = configure({ pi: true });
    const store = createStore({ bridge, maxQueueSize: 5 });
    const addSpy = vi.spyOn(store, 'add');
    const runner = { wake: vi.fn() };
    const res = enqueue(store, runner, 2);
    expect(res).toEqual({ added: 0, requested: 2, refused: 'inspector' });
    expect(addSpy).not.toHaveBeenCalled();
    expect(runner.wake).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith("Can't start the queue while Prompt Inspector is on. Turn it off, then try again.");
  });

  it('adds count items sharing one fingerprint and wakes once', () => {
    const { bridge } = configure();
    const store = createStore({ bridge, maxQueueSize: 5 });
    const runner = { wake: vi.fn() };
    const res = enqueue(store, runner, 3);
    expect(res).toEqual({ added: 3, requested: 3, refused: null });
    expect(runner.wake).toHaveBeenCalledTimes(1);
    const items = store.getItems();
    expect(items).toHaveLength(3);
    expect(items[1].fingerprint).toBe(items[0].fingerprint);
  });

  it('clamps to remaining room', () => {
    const { bridge } = configure();
    const store = createStore({ bridge, maxQueueSize: 2 });
    const runner = { wake: vi.fn() };
    expect(enqueue(store, runner, 5)).toEqual({ added: 2, requested: 5, refused: null });
    expect(enqueue(store, runner, 1)).toEqual({ added: 0, requested: 1, refused: null });
    expect(runner.wake).toHaveBeenCalledTimes(1);
  });
});

describe('resumeQueue inspector gate', () => {
  it('refuses with a toast and does not resume while Prompt Inspector is on', () => {
    const { toast } = configure({ pi: true });
    const runner = { resumeAll: vi.fn() };
    resumeQueue({}, runner);
    expect(runner.resumeAll).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });
});

describe('resumeQueue', () => {
  it('delegates to runner.resumeAll and returns its result', () => {
    configure();
    const runner = { resumeAll: vi.fn(() => 'woken') };
    expect(resumeQueue({}, runner)).toBe('woken');
    expect(runner.resumeAll).toHaveBeenCalledTimes(1);
  });
});
