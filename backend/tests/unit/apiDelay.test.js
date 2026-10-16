const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createApiDelayMiddleware } = require('../../src/middleware/apiDelay');

function createHarness(setting) {
  const scheduled = [];
  const cancelled = [];
  const req = new EventEmitter();
  req.aborted = false;
  const res = new EventEmitter();
  res.destroyed = false;
  res.completedWith = null;
  res.end = (...args) => { res.completedWith = args; return res; };
  const middleware = createApiDelayMiddleware({
    delayService: { getDelaySetting: () => ({ ...setting }) },
    schedule: (callback, milliseconds) => {
      const handle = { callback, milliseconds };
      scheduled.push(handle);
      return handle;
    },
    cancel: (handle) => cancelled.push(handle),
  });
  return { middleware, req, res, scheduled, cancelled };
}

test('API and BOTH scopes capture one delay and preserve end arguments', () => {
  for (const scope of ['API', 'BOTH']) {
    const harness = createHarness({ durationSeconds: 3, scope });
    let nextCalls = 0;
    harness.middleware(harness.req, harness.res, () => { nextCalls += 1; });
    harness.res.end('response-body', 'utf8');
    assert.equal(nextCalls, 1);
    assert.equal(harness.res.completedWith, null);
    assert.equal(harness.scheduled.length, 1);
    assert.equal(harness.scheduled[0].milliseconds, 3000);
    harness.scheduled[0].callback();
    assert.deepEqual(harness.res.completedWith, ['response-body', 'utf8']);
  }
});

test('zero duration and UI scope complete without scheduling', () => {
  for (const setting of [{ durationSeconds: 0, scope: 'API' }, { durationSeconds: 4, scope: 'UI' }]) {
    const harness = createHarness(setting);
    harness.middleware(harness.req, harness.res, () => harness.res.end('now'));
    assert.deepEqual(harness.res.completedWith, ['now']);
    assert.equal(harness.scheduled.length, 0);
  }
});

test('disconnect cleanup cancels a pending delayed response', () => {
  const harness = createHarness({ durationSeconds: 2, scope: 'API' });
  harness.middleware(harness.req, harness.res, () => harness.res.end('late'));
  harness.req.aborted = true;
  harness.req.emit('aborted');
  assert.deepEqual(harness.cancelled, [harness.scheduled[0]]);
  harness.scheduled[0].callback();
  assert.equal(harness.res.completedWith, null);
});

test('a response completed after request abort does not allocate a new timer', () => {
  const harness = createHarness({ durationSeconds: 2, scope: 'BOTH' });
  let finishHandler;
  harness.middleware(harness.req, harness.res, () => { finishHandler = () => harness.res.end('too-late'); });
  harness.req.aborted = true;
  harness.req.emit('aborted');
  finishHandler();
  assert.equal(harness.scheduled.length, 0);
  assert.equal(harness.res.completedWith, null);
});
