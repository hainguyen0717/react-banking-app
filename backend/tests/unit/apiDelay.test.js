const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  createApiDelayMiddleware,
  INVALID_DELAY_TICKET_ERROR,
} = require('../../src/middleware/apiDelay');

function createHarness({ directSample = 3, tickets = new Map() } = {}) {
  const scheduled = [];
  const cancelled = [];
  const req = new EventEmitter();
  req.aborted = false;
  req.headers = {};
  const res = new EventEmitter();
  res.destroyed = false;
  res.completedWith = null;
  res.statusCode = 200;
  res.headers = {};
  res.end = (...args) => { res.completedWith = args; return res; };
  res.setHeader = (name, value) => { res.headers[name] = value; };
  res.status = (statusCode) => { res.statusCode = statusCode; return res; };
  res.json = (body) => { res.body = body; return res; };
  const middleware = createApiDelayMiddleware({
    delayService: {
      sampleApiDelay: () => directSample,
      consumeApiDelayTicket: (ticket) => {
        if (!tickets.has(ticket)) return null;
        const value = tickets.get(ticket);
        tickets.delete(ticket);
        return value;
      },
    },
    schedule: (callback, milliseconds) => {
      const handle = { callback, milliseconds };
      scheduled.push(handle);
      return handle;
    },
    cancel: (handle) => cancelled.push(handle),
  });
  return { middleware, req, res, scheduled, cancelled };
}

test('unticketed clients sample independently and preserve end arguments', () => {
  const harness = createHarness({ directSample: 3 });
  let nextCalls = 0;
  harness.middleware(harness.req, harness.res, () => { nextCalls += 1; });
  harness.res.end('response-body', 'utf8');
  assert.equal(nextCalls, 1);
  assert.equal(harness.res.headers['X-Test-Delay-Seconds'], '3');
  assert.equal(harness.res.completedWith, null);
  assert.equal(harness.scheduled[0].milliseconds, 3000);
  harness.scheduled[0].callback();
  assert.deepEqual(harness.res.completedWith, ['response-body', 'utf8']);
});

test('a valid ticket applies its reserved sample exactly once, including zero', () => {
  for (const sampledSeconds of [0, 4]) {
    const harness = createHarness({ tickets: new Map([['opaque-ticket', sampledSeconds]]) });
    harness.req.headers['x-test-delay-ticket'] = 'opaque-ticket';
    harness.middleware(harness.req, harness.res, () => harness.res.end('body'));
    assert.equal(harness.res.headers['X-Test-Delay-Seconds'], String(sampledSeconds));
    if (sampledSeconds === 0) {
      assert.deepEqual(harness.res.completedWith, ['body']);
      assert.equal(harness.scheduled.length, 0);
    } else {
      assert.equal(harness.scheduled[0].milliseconds, 4000);
    }
  }
});

test('malformed, unknown, and reused supplied tickets return a stable 400 without running the route', () => {
  for (const ticket of ['', 'bad ticket', 'unknown-ticket']) {
    const harness = createHarness();
    harness.req.headers['x-test-delay-ticket'] = ticket;
    let nextCalls = 0;
    harness.middleware(harness.req, harness.res, () => { nextCalls += 1; });
    assert.equal(nextCalls, 0);
    assert.equal(harness.res.statusCode, 400);
    assert.deepEqual(harness.res.body, { error: INVALID_DELAY_TICKET_ERROR });
    assert.equal(harness.scheduled.length, 0);
  }
});

test('disconnect cleanup cancels a pending delayed response', () => {
  const harness = createHarness({ directSample: 2 });
  harness.middleware(harness.req, harness.res, () => harness.res.end('late'));
  harness.req.aborted = true;
  harness.req.emit('aborted');
  assert.deepEqual(harness.cancelled, [harness.scheduled[0]]);
  harness.scheduled[0].callback();
  assert.equal(harness.res.completedWith, null);
});

test('a response completed after request abort does not allocate a new timer', () => {
  const harness = createHarness({ directSample: 2 });
  let finishHandler;
  harness.middleware(harness.req, harness.res, () => { finishHandler = () => harness.res.end('too-late'); });
  harness.req.aborted = true;
  harness.req.emit('aborted');
  finishHandler();
  assert.equal(harness.scheduled.length, 0);
  assert.equal(harness.res.completedWith, null);
});
