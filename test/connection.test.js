import { describe, expect, it } from 'vitest';
import { diffConnection } from '../src/connection.js';

describe('diffConnection', () => {
  const a = { api: 'openai', model: 'm1', preset: 'p1' };
  it('returns [] when identical', () => expect(diffConnection(a, { ...a })).toEqual([]));
  it('returns [] for missing snapshots', () => {
    expect(diffConnection(null, a)).toEqual([]);
    expect(diffConnection(a, undefined)).toEqual([]);
  });
  it('returns [] when all null', () => {
    const n = { api: null, model: null, preset: null };
    expect(diffConnection(n, a)).toEqual([]);
    expect(diffConnection(a, n)).toEqual([]);
  });
  it('names one changed field', () => {
    expect(diffConnection(a, { ...a, model: 'm2' })).toEqual(['model']);
  });
  it('names all changed fields', () => {
    expect(diffConnection(a, { api: 'x', model: 'y', preset: 'z' })).toEqual(['api', 'model', 'preset']);
  });
  it('skips empty-string and undefined values', () => {
    expect(diffConnection(a, { api: '', model: undefined, preset: 'p2' })).toEqual(['preset']);
  });
});
