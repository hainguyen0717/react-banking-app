const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_DELAY_SETTING,
  createDelayService,
  isValidDelaySetting,
} = require('../../src/services/delayService');

test('delay service starts at the process-local default and returns defensive copies', () => {
  const service = createDelayService();
  const first = service.getDelaySetting();
  assert.deepEqual(first, DEFAULT_DELAY_SETTING);
  first.durationSeconds = 42;
  assert.deepEqual(service.getDelaySetting(), DEFAULT_DELAY_SETTING);
});

test('delay service atomically accepts only complete integer settings', () => {
  const service = createDelayService({ durationSeconds: 5, scope: 'API' });
  assert.deepEqual(service.setDelaySetting({ durationSeconds: 60, scope: 'BOTH' }), {
    durationSeconds: 60,
    scope: 'BOTH',
  });

  for (const invalid of [
    null,
    {},
    { durationSeconds: 1 },
    { scope: 'UI' },
    { durationSeconds: -1, scope: 'UI' },
    { durationSeconds: 61, scope: 'UI' },
    { durationSeconds: 1.5, scope: 'UI' },
    { durationSeconds: '1', scope: 'UI' },
    { durationSeconds: 1, scope: 'OTHER' },
    { durationSeconds: 1, scope: 'UI', extra: true },
  ]) {
    assert.equal(isValidDelaySetting(invalid), false);
    assert.equal(service.setDelaySetting(invalid), null);
    assert.deepEqual(service.getDelaySetting(), { durationSeconds: 60, scope: 'BOTH' });
  }
});
