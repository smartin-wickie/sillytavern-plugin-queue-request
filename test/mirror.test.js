import { describe, expect, it, vi } from 'vitest';
import { createMirror } from '../src/mirror.js';
import { buildSnapshot, parseSnapshot } from '../src/persistence.js';
import { createStore } from '../src/store.js';

function setup({ owner = true } = {}) {
  const store = createStore({ bridge: { ctx: () => ({ chat: [], saveChat: vi.fn() }) }, maxQueueSize: 5 });
  const runnerCbs = new Set();
  const runner = {
    getPauseReasons: () => ['restored'],
    getConsecutiveFailures: () => 1,
    onStateChange: (cb) => runnerCbs.add(cb),
    offStateChange: (cb) => runnerCbs.delete(cb),
  };
  const stateCbs = new Set();
  let stored = null;
  const ownership = {
    isOwner: () => owner,
    publishState: vi.fn((s) => { stored = { snapshot: s }; }),
    readState: () => stored,
    onState: (cb) => stateCbs.add(cb),
    offState: (cb) => stateCbs.delete(cb),
  };
  const queue = [];
  const timers = {
    setTimeout: (fn) => { queue.push(fn); return queue.length; },
    clearTimeout: vi.fn(),
  };
  const mirror = createMirror({ store, runner, ownership, buildSnapshot, parseSnapshot, timers });
  return { store, ownership, mirror, queue, stateCbs, setStored: (v) => { stored = v; } };
}

const fp = { mesId: 0, chatLength: 1, swipe0Hash: 'h', name: 'B' };

describe('mirror owner side', () => {
  it('coalesces changes into one publish', () => {
    const t = setup();
    t.mirror.start();
    t.store.add(fp);
    t.store.add(fp);
    expect(t.queue).toHaveLength(1);
    t.queue.shift()();
    expect(t.ownership.publishState).toHaveBeenCalledTimes(1);
    const snap = t.ownership.publishState.mock.calls[0][0];
    expect(snap.items).toHaveLength(2);
    expect(snap.reasons).toEqual(['restored']);
    expect(snap.failures).toBe(1);
    expect(parseSnapshot(snap)).not.toBeNull();
  });

  it('does not publish when not owner', () => {
    const t = setup({ owner: false });
    t.mirror.start();
    t.store.add(fp);
    expect(t.queue).toHaveLength(0);
    expect(t.ownership.publishState).not.toHaveBeenCalled();
  });
});

describe('mirror read-only side', () => {
  const good = { items: [{ id: 'a', status: 'running', createdAt: 1, target: {}, connection: {} }], completed: 2, reasons: [], failures: 0 };

  it('applies the stored snapshot when becoming read-only and on state events', () => {
    const t = setup({ owner: false });
    t.setStored({ snapshot: good });
    t.mirror.start();
    t.store.setReadOnly(true);
    expect(t.store.runningCount()).toBe(1);
    expect(t.store.getCompleted()).toBe(2);
    t.setStored({ snapshot: { ...good, completed: 3 } });
    t.stateCbs.forEach((cb) => cb());
    expect(t.store.getCompleted()).toBe(3);
  });

  it('ignores an invalid snapshot and keeps the previous display', () => {
    const t = setup({ owner: false });
    t.setStored({ snapshot: good });
    t.mirror.start();
    t.store.setReadOnly(true);
    t.setStored({ snapshot: { items: 'bad' } });
    t.stateCbs.forEach((cb) => cb());
    expect(t.store.runningCount()).toBe(1);
  });
});
