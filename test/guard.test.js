import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGuard } from '../src/guard.js';

const EVENT_TYPES = {
  GENERATION_STARTED: 'GENERATION_STARTED',
  GENERATION_ENDED: 'GENERATION_ENDED',
  GENERATION_STOPPED: 'GENERATION_STOPPED',
};

// Minimal on/removeListener/emit EventTarget-like fake, per 02-PATTERNS.md's fake-bridge shape.
function makeEventSource() {
  const listeners = new Map();
  return {
    on(evt, h) {
      if (!listeners.has(evt)) listeners.set(evt, new Set());
      listeners.get(evt).add(h);
    },
    removeListener(evt, h) {
      listeners.get(evt)?.delete(h);
    },
    emit(evt, ...args) {
      for (const h of listeners.get(evt) ?? []) h(...args);
    },
    listenerCount(evt) {
      return listeners.get(evt)?.size ?? 0;
    },
  };
}

function makeBridge(eventSource) {
  return { eventSource, event_types: EVENT_TYPES };
}

function makeRunner() {
  return { pause: vi.fn(), resume: vi.fn(), getPauseReasons: vi.fn(() => ['native']) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createGuard', () => {
  it('pauses the runner when GENERATION_STARTED fires with dryRun === false', async () => {
    const eventSource = makeEventSource();
    const bridge = makeBridge(eventSource);
    const runner = makeRunner();
    const guard = createGuard({ bridge, runner });
    guard.start();

    eventSource.emit(EVENT_TYPES.GENERATION_STARTED, 'normal', {}, false);
    await vi.runAllTimersAsync();

    expect(runner.pause).toHaveBeenCalledWith('native');
  });

  it('does not pause the runner when GENERATION_STARTED fires with dryRun === true (the runner\'s own capture, or another extension\'s dry run)', async () => {
    const eventSource = makeEventSource();
    const bridge = makeBridge(eventSource);
    const runner = makeRunner();
    const guard = createGuard({ bridge, runner });
    guard.start();

    eventSource.emit(EVENT_TYPES.GENERATION_STARTED, 'swipe', {}, true);
    await vi.runAllTimersAsync();

    expect(runner.pause).not.toHaveBeenCalled();
  });

  it('does not pause the runner when GENERATION_STARTED fires with dryRun undefined', async () => {
    const eventSource = makeEventSource();
    const bridge = makeBridge(eventSource);
    const runner = makeRunner();
    const guard = createGuard({ bridge, runner });
    guard.start();

    eventSource.emit(EVENT_TYPES.GENERATION_STARTED, 'normal', {});
    await vi.runAllTimersAsync();

    expect(runner.pause).not.toHaveBeenCalled();
  });

  it('resumes the runner on GENERATION_ENDED', async () => {
    const eventSource = makeEventSource();
    const bridge = makeBridge(eventSource);
    const runner = makeRunner();
    const guard = createGuard({ bridge, runner });
    guard.start();

    eventSource.emit(EVENT_TYPES.GENERATION_ENDED);
    await vi.runAllTimersAsync();

    expect(runner.resume).toHaveBeenCalledTimes(1);
    expect(runner.resume).toHaveBeenCalledWith('native');
  });

  it('resumes the runner on GENERATION_STOPPED', async () => {
    const eventSource = makeEventSource();
    const bridge = makeBridge(eventSource);
    const runner = makeRunner();
    const guard = createGuard({ bridge, runner });
    guard.start();

    eventSource.emit(EVENT_TYPES.GENERATION_STOPPED);
    await vi.runAllTimersAsync();

    expect(runner.resume).toHaveBeenCalledTimes(1);
    expect(runner.resume).toHaveBeenCalledWith('native');
  });

  it('schedules the pause/resume call via a microtask/setTimeout rather than running it inline inside emit (Pitfall 6)', () => {
    const eventSource = makeEventSource();
    const bridge = makeBridge(eventSource);
    const runner = makeRunner();
    const guard = createGuard({ bridge, runner });
    guard.start();

    eventSource.emit(EVENT_TYPES.GENERATION_STARTED, 'normal', {}, false);

    // Not yet called synchronously within emit() — only after the scheduled timer fires.
    expect(runner.pause).not.toHaveBeenCalled();
  });

  it('stop() removes every registered listener; a subsequent emit does nothing', async () => {
    const eventSource = makeEventSource();
    const bridge = makeBridge(eventSource);
    const runner = makeRunner();
    const guard = createGuard({ bridge, runner });
    guard.start();

    expect(eventSource.listenerCount(EVENT_TYPES.GENERATION_STARTED)).toBe(1);
    expect(eventSource.listenerCount(EVENT_TYPES.GENERATION_ENDED)).toBe(1);
    expect(eventSource.listenerCount(EVENT_TYPES.GENERATION_STOPPED)).toBe(1);

    guard.stop();

    expect(eventSource.listenerCount(EVENT_TYPES.GENERATION_STARTED)).toBe(0);
    expect(eventSource.listenerCount(EVENT_TYPES.GENERATION_ENDED)).toBe(0);
    expect(eventSource.listenerCount(EVENT_TYPES.GENERATION_STOPPED)).toBe(0);

    eventSource.emit(EVENT_TYPES.GENERATION_STARTED, 'normal', {}, false);
    await vi.runAllTimersAsync();

    expect(runner.pause).not.toHaveBeenCalled();
  });

  it('calling stop() twice does not throw', () => {
    const eventSource = makeEventSource();
    const bridge = makeBridge(eventSource);
    const runner = makeRunner();
    const guard = createGuard({ bridge, runner });
    guard.start();

    expect(() => {
      guard.stop();
      guard.stop();
    }).not.toThrow();
  });

  it('calls lifecycle.onNativeStart(type) with the pause on a non-dry start, and nothing on a dry run', async () => {
    const eventSource = makeEventSource();
    const bridge = makeBridge(eventSource);
    const runner = makeRunner();
    const lifecycle = { onNativeStart: vi.fn(), onNativeEnd: vi.fn() };
    const guard = createGuard({ bridge, runner, lifecycle });
    guard.start();

    eventSource.emit(EVENT_TYPES.GENERATION_STARTED, 'swipe', {}, true);
    await vi.advanceTimersByTimeAsync(10);
    expect(lifecycle.onNativeStart).not.toHaveBeenCalled();

    eventSource.emit(EVENT_TYPES.GENERATION_STARTED, 'continue', {}, false);
    await vi.advanceTimersByTimeAsync(10);
    expect(lifecycle.onNativeStart).toHaveBeenCalledWith('continue');
    expect(runner.pause).toHaveBeenCalledWith('native');
    guard.stop();
  });

  it('runs lifecycle.onNativeEnd before runner.resume("native") on end and on stop', async () => {
    const eventSource = makeEventSource();
    const bridge = makeBridge(eventSource);
    const runner = makeRunner();
    const order = [];
    const lifecycle = { onNativeEnd: vi.fn(() => order.push('end')) };
    runner.resume.mockImplementation((r) => order.push(`resume:${r}`));
    const guard = createGuard({ bridge, runner, lifecycle });
    guard.start();

    eventSource.emit(EVENT_TYPES.GENERATION_ENDED);
    await vi.advanceTimersByTimeAsync(10);
    eventSource.emit(EVENT_TYPES.GENERATION_STOPPED);
    await vi.advanceTimersByTimeAsync(10);

    expect(order).toEqual(['end', 'resume:native', 'end', 'resume:native']);
    expect(runner.resume).not.toHaveBeenCalledWith();
  });

  it('watchdog releases the native pause after two consecutive idle polls', async () => {
    const eventSource = makeEventSource();
    const bridge = { ...makeBridge(eventSource), isGenerating: () => false, swipeState: () => 'none' };
    const runner = makeRunner();
    const lifecycle = { onNativeEnd: vi.fn() };
    const guard = createGuard({ bridge, runner, lifecycle });
    guard.start();

    eventSource.emit(EVENT_TYPES.GENERATION_STARTED, 'normal', {}, false);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(500);
    expect(runner.resume).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(lifecycle.onNativeEnd).toHaveBeenCalledTimes(1);
    expect(runner.resume).toHaveBeenCalledWith('native');
    expect(vi.getTimerCount()).toBe(0);
    guard.stop();
  });

  it('watchdog does not release while still generating, and stop() clears the interval', async () => {
    const eventSource = makeEventSource();
    const bridge = { ...makeBridge(eventSource), isGenerating: () => true, swipeState: () => 'none' };
    const runner = makeRunner();
    const guard = createGuard({ bridge, runner });
    guard.start();

    eventSource.emit(EVENT_TYPES.GENERATION_STARTED, 'normal', {}, false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(runner.resume).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    guard.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not throw when optional lifecycle hooks and bridge idle accessors are missing', async () => {
    const eventSource = makeEventSource();
    const bridge = makeBridge(eventSource);
    const runner = makeRunner();
    const guard = createGuard({ bridge, runner });
    guard.start();

    eventSource.emit(EVENT_TYPES.GENERATION_STARTED, 'normal', {}, false);
    eventSource.emit(EVENT_TYPES.GENERATION_ENDED);
    await expect(vi.runAllTimersAsync()).resolves.not.toThrow();
    guard.stop();
  });
});
