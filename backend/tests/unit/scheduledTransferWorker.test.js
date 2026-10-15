const assert = require('node:assert/strict');
const test = require('node:test');
const { createScheduledTransferWorker } = require('../../src/workers/scheduledTransferWorker');
const { getScheduledTransferConfig } = require('../../src/config/scheduledTransferConfig');

test('scheduled transfer config validates the poll interval', () => {
  assert.deepEqual(getScheduledTransferConfig({}), { pollIntervalMs: 1000 });
  assert.deepEqual(getScheduledTransferConfig({ SCHEDULED_TRANSFER_POLL_INTERVAL_MS: '250' }), { pollIntervalMs: 250 });
  assert.throws(() => getScheduledTransferConfig({ SCHEDULED_TRANSFER_POLL_INTERVAL_MS: '0' }), /positive safe integer/);
});

test('worker coalesces overlapping runs and waits for cleanup', async () => {
  let release;
  let calls = 0;
  const task = () => { calls += 1; return new Promise((resolve) => { release = resolve; }); };
  const worker = createScheduledTransferWorker({ processDueScheduledTransfers: task, pollIntervalMs: 1000, logger: { error: () => {} } });
  const first = worker.runNow();
  const second = worker.runNow();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  await worker.stop();
});
