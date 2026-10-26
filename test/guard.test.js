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
  return { pause: vi.fn(), resume: vi.fn() };
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
});
