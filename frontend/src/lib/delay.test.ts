import { describe, expect, it } from 'vitest';
import {
  isDelaySetting,
  parseDelayDuration,
  shouldDelayUiNavigation,
} from './delay';

describe('delay helpers', () => {
  it('accepts exact complete settings only', () => {
    expect(isDelaySetting({ durationSeconds: 0, scope: 'BOTH' })).toBe(true);
    expect(isDelaySetting({ durationSeconds: 60, scope: 'API' })).toBe(true);
    expect(isDelaySetting({ durationSeconds: 1.5, scope: 'UI' })).toBe(false);
    expect(isDelaySetting({ durationSeconds: 61, scope: 'UI' })).toBe(false);
    expect(isDelaySetting({ durationSeconds: 1, scope: 'OTHER' })).toBe(false);
  });

  it('parses only whole seconds within the supported range', () => {
    expect(parseDelayDuration('0')).toBe(0);
    expect(parseDelayDuration('60')).toBe(60);
    expect(parseDelayDuration('1.5')).toBeNull();
    expect(parseDelayDuration('')).toBeNull();
    expect(parseDelayDuration('-1')).toBeNull();
    expect(parseDelayDuration('61')).toBeNull();
  });

  it('delays navigation only for non-zero UI-inclusive settings', () => {
    expect(shouldDelayUiNavigation({ durationSeconds: 2, scope: 'UI' })).toBe(true);
    expect(shouldDelayUiNavigation({ durationSeconds: 2, scope: 'BOTH' })).toBe(true);
    expect(shouldDelayUiNavigation({ durationSeconds: 2, scope: 'API' })).toBe(false);
    expect(shouldDelayUiNavigation({ durationSeconds: 0, scope: 'BOTH' })).toBe(false);
  });
});
