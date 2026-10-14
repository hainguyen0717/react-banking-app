const DEFAULT_OPENING_BALANCE_CENTS = 100_000_000;

function getDefaultAccountBalanceCents(environment = process.env) {
  const rawValue = environment.DEFAULT_ACCOUNT_BALANCE_CENTS;

  if (rawValue === undefined || rawValue === '') {
    return DEFAULT_OPENING_BALANCE_CENTS;
  }

  const parsed = Number(rawValue);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('DEFAULT_ACCOUNT_BALANCE_CENTS must be a non-negative safe integer.');
  }

  return parsed;
}

module.exports = {
  DEFAULT_OPENING_BALANCE_CENTS,
  getDefaultAccountBalanceCents,
};
