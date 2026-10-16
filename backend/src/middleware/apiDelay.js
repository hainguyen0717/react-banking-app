function createApiDelayMiddleware({
  delayService,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  if (!delayService || typeof delayService.getDelaySetting !== 'function') {
    throw new TypeError('A delay service is required.');
  }

  return (req, res, next) => {
    const captured = delayService.getDelaySetting();
    const shouldDelay = captured.durationSeconds > 0
      && (captured.scope === 'API' || captured.scope === 'BOTH');

    if (!shouldDelay) {
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
      }, captured.durationSeconds * 1000);
      return res;
    };

    next();
  };
}

module.exports = { createApiDelayMiddleware };
