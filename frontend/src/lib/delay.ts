export const DELAY_SCOPES = ['API', 'UI', 'BOTH'] as const;

export type DelayScope = typeof DELAY_SCOPES[number];

export interface DelaySetting {
  minSeconds: number;
  maxSeconds: number;
  scope: DelayScope;
}

export interface DelaySample {
  ticket: string;
  sampledSeconds: number;
}

export const DEFAULT_DELAY_SETTING: DelaySetting = { minSeconds: 0, maxSeconds: 0, scope: 'BOTH' };

export function isDelaySetting(value: unknown): value is DelaySetting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<DelaySetting>;
  return Object.keys(value).length === 3
    && Number.isInteger(candidate.minSeconds)
    && Number.isInteger(candidate.maxSeconds)
    && (candidate.minSeconds as number) >= 0
    && (candidate.maxSeconds as number) <= 60
    && (candidate.minSeconds as number) <= (candidate.maxSeconds as number)
    && DELAY_SCOPES.includes(candidate.scope as DelayScope);
}

export function isDelaySample(value: unknown): value is DelaySample {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<DelaySample>;
  return Object.keys(value).length === 2
    && typeof candidate.ticket === 'string'
    && candidate.ticket.length > 0
    && Number.isInteger(candidate.sampledSeconds)
    && (candidate.sampledSeconds as number) >= 0
    && (candidate.sampledSeconds as number) <= 60;
}

export function parseDelaySeconds(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= 60 ? seconds : null;
}

export function sampleInclusiveDelay(
  setting: Pick<DelaySetting, 'minSeconds' | 'maxSeconds'>,
  random: () => number = Math.random,
): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('Delay random source must return a value from 0 (inclusive) to 1 (exclusive).');
  }
  return setting.minSeconds + Math.floor(value * (setting.maxSeconds - setting.minSeconds + 1));
}

export function shouldDelayUiNavigation(setting: DelaySetting) {
  return setting.maxSeconds > 0 && (setting.scope === 'UI' || setting.scope === 'BOTH');
}

export function formatDelayRange(setting: Pick<DelaySetting, 'minSeconds' | 'maxSeconds'>) {
  return setting.minSeconds === setting.maxSeconds
    ? `${setting.minSeconds}s`
    : `${setting.minSeconds}–${setting.maxSeconds}s`;
}
