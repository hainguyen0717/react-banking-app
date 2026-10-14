export const ACCOUNT_TYPES = ['EVERYDAY', 'SAVINGS', 'BUSINESS'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export function parseAudToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const [dollars, cents = ''] = trimmed.split('.');
  const amount = Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function formatAud(cents: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}
