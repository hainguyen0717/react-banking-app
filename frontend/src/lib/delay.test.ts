import { describe, expect, it } from 'vitest';
import {
  formatDelayRange,
  isDelaySample,
  isDelaySetting,
  parseDelaySeconds,
  sampleInclusiveDelay,
  shouldDelayUiNavigation,
} from './delay';

describe('delay helpers', () => {
  it('accepts exact complete ordered range settings only', () => {
    expect(isDelaySetting({ minSeconds: 0, maxSeconds: 0, scope: 'BOTH' })).toBe(true);
    expect(isDelaySetting({ minSeconds: 2, maxSeconds: 60, scope: 'API' })).toBe(true);
    expect(isDelaySetting({ minSeconds: 3, maxSeconds: 2, scope: 'UI' })).toBe(false);
    expect(isDelaySetting({ minSeconds: 1.5, maxSeconds: 2, scope: 'UI' })).toBe(false);
    expect(isDelaySetting({ minSeconds: 0, maxSeconds: 61, scope: 'UI' })).toBe(false);
    expect(isDelaySetting({ minSeconds: 1, maxSeconds: 2, scope: 'OTHER' })).toBe(false);
    expect(isDelaySetting({ minSeconds: 1, maxSeconds: 2, scope: 'UI', extra: true })).toBe(false);
  });

  it('validates sampled tickets and parses whole seconds in range', () => {
    expect(isDelaySample({ ticket: 'opaque', sampledSeconds: 4 })).toBe(true);
    expect(isDelaySample({ ticket: '', sampledSeconds: 4 })).toBe(false);
    expect(isDelaySample({ ticket: 'opaque', sampledSeconds: 61 })).toBe(false);
    expect(parseDelaySeconds('0')).toBe(0);
    expect(parseDelaySeconds('60')).toBe(60);
    expect(parseDelaySeconds('1.5')).toBeNull();
    expect(parseDelaySeconds('')).toBeNull();
    expect(parseDelaySeconds('-1')).toBeNull();
  });

  it('samples inclusive bounds and formats fixed and variable ranges', () => {
    expect(sampleInclusiveDelay({ minSeconds: 2, maxSeconds: 5 }, () => 0)).toBe(2);
    expect(sampleInclusiveDelay({ minSeconds: 2, maxSeconds: 5 }, () => 0.999999)).toBe(5);
    expect(sampleInclusiveDelay({ minSeconds: 4, maxSeconds: 4 }, () => 0.5)).toBe(4);
    expect(formatDelayRange({ minSeconds: 2, maxSeconds: 5 })).toBe('2–5s');
    expect(formatDelayRange({ minSeconds: 4, maxSeconds: 4 })).toBe('4s');
  });

  it('delays navigation only for UI-inclusive settings with a possible nonzero sample', () => {
    expect(shouldDelayUiNavigation({ minSeconds: 0, maxSeconds: 2, scope: 'UI' })).toBe(true);
    expect(shouldDelayUiNavigation({ minSeconds: 2, maxSeconds: 2, scope: 'BOTH' })).toBe(true);
    expect(shouldDelayUiNavigation({ minSeconds: 2, maxSeconds: 2, scope: 'API' })).toBe(false);
    expect(shouldDelayUiNavigation({ minSeconds: 0, maxSeconds: 0, scope: 'BOTH' })).toBe(false);
  });
});
