function createScheduledTransferWorker({ processDueScheduledTransfers, pollIntervalMs, logger = console } = {}) {
  let timer = null;
  let activeRun = null;
  const runNow = () => {
    if (activeRun) return activeRun;
    activeRun = Promise.resolve()
      .then(processDueScheduledTransfers)
      .catch((error) => logger.error('Scheduled transfer processing failed', error))
      .finally(() => { activeRun = null; });
    return activeRun;
  };
  const start = () => {
    if (timer) return;
    void runNow();
    timer = setInterval(() => { void runNow(); }, pollIntervalMs);
    timer.unref?.();
  };
  const stop = async () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (activeRun) await activeRun;
  };
  return { start, stop, runNow };
}

module.exports = { createScheduledTransferWorker };
