const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_DELAY_SETTING,
  createDelayService,
  isValidDelaySetting,
  sampleInclusive,
} = require('../../src/services/delayService');

test('delay service starts at the process-local range default and returns defensive copies', () => {
  const service = createDelayService();
  const first = service.getDelaySetting();
  assert.deepEqual(first, DEFAULT_DELAY_SETTING);
  first.maxSeconds = 42;
  assert.deepEqual(service.getDelaySetting(), DEFAULT_DELAY_SETTING);
});

test('delay service atomically accepts only complete ordered integer ranges', () => {
  const service = createDelayService({ minSeconds: 2, maxSeconds: 5, scope: 'API' });
  assert.deepEqual(service.setDelaySetting({ minSeconds: 4, maxSeconds: 60, scope: 'BOTH' }), {
    minSeconds: 4,
    maxSeconds: 60,
    scope: 'BOTH',
  });

  for (const invalid of [
    null,
    {},
    { minSeconds: 1, maxSeconds: 2 },
    { minSeconds: -1, maxSeconds: 2, scope: 'UI' },
    { minSeconds: 3, maxSeconds: 2, scope: 'UI' },
    { minSeconds: 0, maxSeconds: 61, scope: 'UI' },
    { minSeconds: 1.5, maxSeconds: 2, scope: 'UI' },
    { minSeconds: '1', maxSeconds: 2, scope: 'UI' },
    { minSeconds: 1, maxSeconds: 2, scope: 'OTHER' },
    { minSeconds: 1, maxSeconds: 2, scope: 'UI', extra: true },
  ]) {
    assert.equal(isValidDelaySetting(invalid), false);
    assert.equal(service.setDelaySetting(invalid), null);
    assert.deepEqual(service.getDelaySetting(), { minSeconds: 4, maxSeconds: 60, scope: 'BOTH' });
  }
});

test('inclusive sampling reaches both bounds and fixed ranges remain fixed', () => {
  assert.equal(sampleInclusive(2, 5, () => 0), 2);
  assert.equal(sampleInclusive(2, 5, () => 0.999999), 5);
  assert.equal(sampleInclusive(7, 7, () => 0.75), 7);
  assert.throws(() => sampleInclusive(0, 1, () => 1), /random source/);
});

test('API tickets reserve one sample and are opaque, expiring, and single use', () => {
  let currentTime = 1000;
  const ids = ['ticket-one', 'ticket-two'];
  const service = createDelayService(
    { minSeconds: 2, maxSeconds: 5, scope: 'BOTH' },
    {
      random: () => 0.999999,
      now: () => currentTime,
      createTicketId: () => ids.shift(),
      ticketTtlMs: 100,
    },
  );

  assert.deepEqual(service.reserveApiDelay(), { ticket: 'ticket-one', sampledSeconds: 5 });
  assert.equal(service.consumeApiDelayTicket('ticket-one'), 5);
  assert.equal(service.consumeApiDelayTicket('ticket-one'), null);

  assert.deepEqual(service.reserveApiDelay(), { ticket: 'ticket-two', sampledSeconds: 5 });
  currentTime = 1100;
  assert.equal(service.consumeApiDelayTicket('ticket-two'), null);
});

test('UI-only scope reserves a zero-second API ticket while direct API samples are independent', () => {
  const values = [0, 0.999999];
  const service = createDelayService(
    { minSeconds: 3, maxSeconds: 8, scope: 'API' },
    { random: () => values.shift(), createTicketId: () => 'ticket' },
  );
  assert.equal(service.sampleApiDelay(), 3);
  assert.equal(service.sampleApiDelay(), 8);

  service.setDelaySetting({ minSeconds: 3, maxSeconds: 8, scope: 'UI' });
  assert.deepEqual(service.reserveApiDelay(), { ticket: 'ticket', sampledSeconds: 0 });
  assert.equal(service.consumeApiDelayTicket('ticket'), 0);
});
