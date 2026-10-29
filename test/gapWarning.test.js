import { describe, expect, it, vi } from 'vitest';
import { formatGapLines, createGapWarner } from '../src/gapWarning.js';

const none = { autoSwipe: false, interceptors: [], squash: false };

function memStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: vi.fn((k, v) => {
      data[k] = String(v);
    }),
  };
}

describe('formatGapLines', () => {
  it('returns [] when no gap is active', () => {
    expect(formatGapLines(none)).toEqual([]);
  });

  it('names auto-swipe, squash and interceptors', () => {
    expect(formatGapLines({ ...none, autoSwipe: true }).join(' ')).toContain('Auto-swipe');
    expect(formatGapLines({ ...none, squash: true }).join(' ')).toContain('squash');
    const lines = formatGapLines({ ...none, interceptors: ['Vector Storage', 'MessageSummarize'] }).join(' ');
    expect(lines).toContain('Vector Storage');
    expect(lines).toContain('MessageSummarize');
    expect(lines).toContain('may not run');
  });

  it('passes extension names through as plain text (toastr does the escaping)', () => {
    const out = formatGapLines({ ...none, interceptors: [`Foo & Bar`, `Bob's <Helper>`] }).join(' ');
    expect(out).toContain(`(Foo & Bar, Bob's <Helper>)`);
    expect(out).not.toContain('&amp;');
    expect(out).not.toContain('&#39;');
  });
});

describe('createGapWarner', () => {
  it('does not warn or mark the session when no gaps are active', () => {
    const storage = memStorage();
    const toast = { warning: vi.fn() };
    const w = createGapWarner({ storage });
    expect(w.maybeWarn(none, toast)).toBe(false);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('warns once with a 10s timeout and marks the session', () => {
    const storage = memStorage();
    const toast = { warning: vi.fn() };
    const w = createGapWarner({ storage });
    const gaps = { ...none, autoSwipe: true };
    expect(w.maybeWarn(gaps, toast)).toBe(true);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning.mock.calls[0][1]).toMatchObject({ timeOut: 10000, escapeHtml: true });
    expect(storage.data.qs_gap_warned).toBe('1');
    expect(w.maybeWarn(gaps, toast)).toBe(false);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it('warns later if a gap becomes active after a no-gap call', () => {
    const toast = { warning: vi.fn() };
    const w = createGapWarner({ storage: memStorage() });
    expect(w.maybeWarn(none, toast)).toBe(false);
    expect(w.maybeWarn({ ...none, squash: true }, toast)).toBe(true);
  });

  it('falls back to an in-memory flag when storage throws', () => {
    const storage = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    const toast = { warning: vi.fn() };
    const w = createGapWarner({ storage });
    const gaps = { ...none, autoSwipe: true };
    expect(w.maybeWarn(gaps, toast)).toBe(true);
    expect(w.maybeWarn(gaps, toast)).toBe(false);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it('does not warn when storage already holds the flag', () => {
    const toast = { warning: vi.fn() };
    const w = createGapWarner({ storage: memStorage({ qs_gap_warned: '1' }) });
    expect(w.maybeWarn({ ...none, autoSwipe: true }, toast)).toBe(false);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('never throws when the toast throws, and does not mark as warned', () => {
    const toast = {
      warning: vi.fn(() => {
        throw new Error('boom');
      }),
    };
    const storage = memStorage();
    const w = createGapWarner({ storage });
    const gaps = { ...none, autoSwipe: true };
    expect(() => w.maybeWarn(gaps, toast)).not.toThrow();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(w.maybeWarn(gaps, { warning: vi.fn() })).toBe(true);
  });
});
