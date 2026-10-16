const DELAY_TICKET_HEADER = 'x-test-delay-ticket';
const DELAY_SECONDS_HEADER = 'X-Test-Delay-Seconds';
const INVALID_DELAY_TICKET_ERROR = 'Invalid or expired test delay ticket.';

function readDelayTicket(req) {
  const value = req.headers?.[DELAY_TICKET_HEADER];
  if (value === undefined) return { supplied: false, ticket: null };
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || !/^[A-Za-z0-9._~-]+$/.test(value)) {
    return { supplied: true, ticket: null };
  }
  return { supplied: true, ticket: value };
}

function createApiDelayMiddleware({
  delayService,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  if (
    !delayService
    || typeof delayService.sampleApiDelay !== 'function'
    || typeof delayService.consumeApiDelayTicket !== 'function'
  ) {
    throw new TypeError('A delay service with sampling and ticket consumption is required.');
  }

  return (req, res, next) => {
    const suppliedTicket = readDelayTicket(req);
    let sampledSeconds;

    if (suppliedTicket.supplied) {
      sampledSeconds = suppliedTicket.ticket === null
        ? null
        : delayService.consumeApiDelayTicket(suppliedTicket.ticket);
      if (sampledSeconds === null) {
        res.setHeader(DELAY_SECONDS_HEADER, '0');
        res.status(400).json({ error: INVALID_DELAY_TICKET_ERROR });
        return;
      }
    } else {
      sampledSeconds = delayService.sampleApiDelay();
    }

    res.setHeader(DELAY_SECONDS_HEADER, String(sampledSeconds));
    if (sampledSeconds === 0) {
      next();
      return;
    }

    const originalEnd = res.end.bind(res);
    let timer = null;
    let completed = false;
    let endCaptured = false;
    let disconnected = false;

    const cleanup = () => {
      disconnected = true;
      if (timer !== null) {
        cancel(timer);
        timer = null;
      }
      req.removeListener?.('aborted', cleanup);
      res.removeListener?.('close', cleanup);
    };

    req.once?.('aborted', cleanup);
    res.once?.('close', cleanup);

    res.end = (...args) => {
      if (completed || endCaptured || disconnected) return res;
      endCaptured = true;
      timer = schedule(() => {
        timer = null;
        if (completed || disconnected || req.aborted || res.destroyed) return;
        completed = true;
        req.removeListener?.('aborted', cleanup);
        res.removeListener?.('close', cleanup);
        originalEnd(...args);
      }, sampledSeconds * 1000);
      return res;
    };

    next();
  };
}

module.exports = {
  createApiDelayMiddleware,
  readDelayTicket,
  DELAY_TICKET_HEADER,
  DELAY_SECONDS_HEADER,
  INVALID_DELAY_TICKET_ERROR,
};
