import { describe, expect, it } from 'vitest';
import { createRunAccumulator } from '../src/toastAccumulator.js';

describe('createRunAccumulator', () => {
  it('noteActivity(true) with no active run starts one and returns null', () => {
    const acc = createRunAccumulator();
    expect(acc.noteActivity(true)).toBeNull();
  });

  it('noteActivity(false) with an active run ends it and returns the drained snapshot', () => {
    const acc = createRunAccumulator();
    acc.noteActivity(true);
    acc.recordDone();
    const drained = acc.noteActivity(false);
    expect(drained).toEqual({ completed: 1, failures: new Map() });
  });

  it('noteActivity(true) while already active (no boundary crossed) returns undefined and does not reset accumulated state', () => {
    const acc = createRunAccumulator();
    acc.noteActivity(true);
    acc.recordDone();
    acc.recordDone();
    const result = acc.noteActivity(true); // still active -> no boundary crossed
    expect(result).toBeUndefined();
    const drained = acc.noteActivity(false);
    expect(drained).toEqual({ completed: 2, failures: new Map() });
  });

  it('noteActivity(false) while already idle (no boundary crossed) returns undefined', () => {
    const acc = createRunAccumulator();
    expect(acc.noteActivity(false)).toBeUndefined();
  });

  it('recordDone() with no prior noteActivity(true) still accumulates correctly (auto-start)', () => {
    const acc = createRunAccumulator();
    acc.recordDone();
    const drained = acc.noteActivity(false);
    expect(drained).toEqual({ completed: 1, failures: new Map() });
  });

  it('recordFailed(reason) with no prior noteActivity(true) still accumulates correctly (auto-start)', () => {
    const acc = createRunAccumulator();
    acc.recordFailed('api');
    const drained = acc.noteActivity(false);
    expect(drained.completed).toBe(0);
    expect(drained.failures.get('api')).toBe(1);
  });

  it('recordFailed(reason) increments the count for repeated reasons on the active run', () => {
    const acc = createRunAccumulator();
    acc.noteActivity(true);
    acc.recordFailed('api');
    acc.recordFailed('api');
    acc.recordFailed('empty');
    const drained = acc.noteActivity(false);
    expect(drained.failures.get('api')).toBe(2);
    expect(drained.failures.get('empty')).toBe(1);
  });

  it('full run sequence: noteActivity(true) -> recordDone() x2 -> recordFailed("api") -> noteActivity(false) returns the exact drained snapshot', () => {
    const acc = createRunAccumulator();
    expect(acc.noteActivity(true)).toBeNull();
    acc.recordDone();
    acc.recordDone();
    acc.recordFailed('api');
    const drained = acc.noteActivity(false);
    expect(drained.completed).toBe(2);
    expect(drained.failures).toEqual(new Map([['api', 1]]));
  });

  it('a new run after a drained run starts fresh (no leftover state)', () => {
    const acc = createRunAccumulator();
    acc.noteActivity(true);
    acc.recordDone();
    acc.noteActivity(false);

    expect(acc.noteActivity(true)).toBeNull();
    const drained = acc.noteActivity(false);
    expect(drained).toEqual({ completed: 0, failures: new Map() });
  });
});

describe('createRunAccumulator reset', () => {
  it('reset() discards the run so a drain reports nothing and the next run starts fresh', () => {
    const acc = createRunAccumulator();
    acc.noteActivity(true);
    acc.recordDone();
    acc.recordFailed('api');
    acc.reset();

    expect(acc.noteActivity(false)).toBeUndefined();
    expect(acc.noteActivity(true)).toBeNull();
    expect(acc.noteActivity(false)).toEqual({ completed: 0, failures: new Map() });
  });
});
