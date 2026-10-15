const DEFAULT_SCHEDULED_TRANSFER_POLL_INTERVAL_MS = 1000;

function getScheduledTransferConfig(env = process.env) {
  const value = env.SCHEDULED_TRANSFER_POLL_INTERVAL_MS;
  const pollIntervalMs = value === undefined || value === ''
    ? DEFAULT_SCHEDULED_TRANSFER_POLL_INTERVAL_MS
    : Number(value);
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error('SCHEDULED_TRANSFER_POLL_INTERVAL_MS must be a positive safe integer.');
  }
  return { pollIntervalMs };
}

module.exports = { DEFAULT_SCHEDULED_TRANSFER_POLL_INTERVAL_MS, getScheduledTransferConfig };
