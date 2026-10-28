import { describe, expect, it } from 'vitest';
import { failuresInARow, pauseReasonLabel, statusLineFor } from '../src/pauseLabels.js';

describe('pauseReasonLabel', () => {
  it('returns locked literals', () => {
    expect(pauseReasonLabel('restored')).toBe('restored after reload');
    expect(pauseReasonLabel('connection')).toBe('connection changed');
    expect(pauseReasonLabel('inspector')).toBe('Prompt Inspector is on');
    expect(pauseReasonLabel('takeover')).toBe('taken over from another tab');
  });
  it('formats failures with the count', () => {
    expect(pauseReasonLabel('failures', { failures: 3 })).toBe('3 failures in a row');
  });
  it('uses the singular for one failure (IN-01)', () => {
    expect(pauseReasonLabel('failures', { failures: 1 })).toBe('1 failure in a row');
    expect(failuresInARow(1)).toBe('1 failure in a row');
    expect(failuresInARow(0)).toBe('0 failures in a row');
  });
  it('returns empty for unknown codes', () => {
    expect(pauseReasonLabel('nope')).toBe('');
  });
});

describe('statusLineFor', () => {
  it('native only waits for the generation', () => {
    expect(statusLineFor(['native'])).toBe('Waiting for your generation to finish');
  });
  it('uses the primary reason by priority', () => {
    expect(statusLineFor(['failures', 'restored'], { failures: 3 })).toBe('Paused: restored after reload');
    expect(statusLineFor(['native', 'takeover', 'restored'])).toBe('Paused: taken over from another tab');
  });
  it('is empty for no reasons', () => {
    expect(statusLineFor([])).toBe('');
  });
});
