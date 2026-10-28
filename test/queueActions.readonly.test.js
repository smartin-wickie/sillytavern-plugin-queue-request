import { describe, expect, it, vi } from 'vitest';
import { cancelAll, resumeQueue, enqueue, configureQueueActions, READONLY_TEXT } from '../src/queueActions.js';

function setup() {
  const toast = { info: vi.fn(), warning: vi.fn() };
  const bridge = { ctx: vi.fn(), promptInspectorEnabled: () => false };
  configureQueueActions({ bridge, toast });
  const store = {
    isReadOnly: () => true,
    getMaxQueueSize: () => 5,
    pendingCount: () => 1,
    runningCount: () => 0,
    getItems: vi.fn(() => []),
    add: vi.fn(),
    drop: vi.fn(),
  };
  const runner = { wake: vi.fn(), abortRunning: vi.fn(), resumeAll: vi.fn() };
  return { toast, bridge, store, runner };
}

describe('read-only no-ops', () => {
  it('enqueue refuses with a toast and adds nothing', () => {
    const { toast, store, runner, bridge } = setup();
    const r = enqueue(store, runner, 2);
    expect(r).toEqual({ added: 0, requested: 2, refused: 'readonly' });
    expect(toast.warning).toHaveBeenCalledWith(READONLY_TEXT);
    expect(store.add).not.toHaveBeenCalled();
    expect(bridge.ctx).not.toHaveBeenCalled();
    expect(runner.wake).not.toHaveBeenCalled();
  });

  it('cancelAll returns 0 and touches nothing', () => {
    const { toast, store, runner } = setup();
    expect(cancelAll(store, runner)).toBe(0);
    expect(toast.warning).toHaveBeenCalledWith(READONLY_TEXT);
    expect(store.drop).not.toHaveBeenCalled();
    expect(runner.abortRunning).not.toHaveBeenCalled();
  });

  it('resumeQueue does not resume the runner', () => {
    const { toast, store, runner } = setup();
    expect(resumeQueue(store, runner)).toBeUndefined();
    expect(toast.warning).toHaveBeenCalledWith(READONLY_TEXT);
    expect(runner.resumeAll).not.toHaveBeenCalled();
  });
});
