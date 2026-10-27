import { describe, expect, it, vi } from 'vitest';
import { createStore } from '../src/store.js';
import { cancelAll } from '../src/queueActions.js';

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
