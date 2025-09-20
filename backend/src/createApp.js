const express = require('express');
const { authenticateCustomer } = require('./services/customerService');
const { getPrismaClient } = require('./lib/prisma');

const defaultLogger = {
  info: (...args) => console.log(...args),
  error: (...args) => console.error(...args)
};

function createRequestLogger(logger = defaultLogger) {
  return (req, res, next) => {
    const startTime = process.hrtime.bigint();
    res.on('finish', () => {
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;
      const message = `${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs.toFixed(1)} ms)`;

      if (res.statusCode >= 500) {
        logger.error(message);
      } else {
        logger.info(message);
      }
    });

    next();
  };
}

function createApp({
  prisma = getPrismaClient(),
  services = { authenticateCustomer },
  logger = defaultLogger
} = {}) {
  const app = express();

  app.use(express.json());
  app.use(createRequestLogger(logger));

  app.post('/api/login', async (req, res) => {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      logger.info('Login attempt rejected due to missing email or password.');
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
      const customer = await services.authenticateCustomer(email, password);

      if (!customer) {
        logger.info(`Invalid login attempt for email: ${email}`);
        return res.status(401).json({ error: 'Invalid credentials.' });
      }

      logger.info(`Customer ${email} authenticated successfully.`);
      return res.json(customer);
    } catch (error) {
      logger.error('Failed to authenticate customer', error);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  });

  app.get('/api/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok' });
    } catch (error) {
      logger.error('Database health check failed', error);
      res.status(503).json({ status: 'unhealthy' });
    }
  });

  // Temporary backwards compatibility for existing health checks
  app.get('/health', (_req, res) => {
    res.redirect(308, '/api/health');
  });

  return app;
}

module.exports = {
  createApp
};
