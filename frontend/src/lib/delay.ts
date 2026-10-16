export const DELAY_SCOPES = ['API', 'UI', 'BOTH'] as const;

export type DelayScope = typeof DELAY_SCOPES[number];

export interface DelaySetting {
  durationSeconds: number;
  scope: DelayScope;
}

export const DEFAULT_DELAY_SETTING: DelaySetting = { durationSeconds: 0, scope: 'BOTH' };

export function isDelaySetting(value: unknown): value is DelaySetting {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DelaySetting>;
  return Number.isInteger(candidate.durationSeconds)
    && (candidate.durationSeconds as number) >= 0
    && (candidate.durationSeconds as number) <= 60
    && DELAY_SCOPES.includes(candidate.scope as DelayScope);
}

export function parseDelayDuration(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const durationSeconds = Number(value);
  return Number.isInteger(durationSeconds) && durationSeconds >= 0 && durationSeconds <= 60
    ? durationSeconds
    : null;
}

export function shouldDelayUiNavigation(setting: DelaySetting) {
  return setting.durationSeconds > 0 && (setting.scope === 'UI' || setting.scope === 'BOTH');
}
