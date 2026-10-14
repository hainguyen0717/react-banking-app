const express = require('express');
const cors = require('cors');
const customerService = require('./services/customerService');
const accountService = require('./services/accountService');
const transferService = require('./services/transferService');
const { BankingError } = require('./errors/BankingError');
const { getPrismaClient } = require('./lib/prisma');
const openApiDocument = require('./docs/openapi.json');

const LOCAL_FRONTEND_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

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

function createDefaultServices(prisma) {
  return {
    ...customerService.createCustomerService({ prisma }),
    ...accountService.createAccountService({ prisma }),
    ...transferService.createTransferService({ prisma }),
  };
}

function resolveCorsOrigin(origin, callback) {
  // Requests without an Origin header are non-browser/same-origin clients and
  // do not need a CORS response header.
  callback(null, !origin || LOCAL_FRONTEND_ORIGINS.has(origin));
}

function createApp({
  prisma = getPrismaClient(),
  services = {},
  logger = defaultLogger
} = {}) {
  const app = express();
  const resolvedServices = {
    ...createDefaultServices(prisma),
    ...services,
  };

  app.use(cors({ origin: resolveCorsOrigin, credentials: true }));
  app.use(express.json());
  app.use(createRequestLogger(logger));

  app.post('/api/login', async (req, res) => {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      logger.info('Login attempt rejected due to missing email or password.');
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
      const customer = await resolvedServices.authenticateCustomer(email, password);

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

  app.post('/api/customers', async (req, res) => {
    try {
      const customer = await resolvedServices.createCustomer(req.body);
      return res.status(201).json(customer);
    } catch (error) {
      return handleApiError(error, res, logger, 'Failed to create customer');
    }
  });

  app.post('/api/customers/:customerId/accounts', async (req, res) => {
    try {
      const account = await resolvedServices.createAccount(req.params.customerId, req.body);
      return res.status(201).json(account);
    } catch (error) {
      return handleApiError(error, res, logger, 'Failed to create account');
    }
  });

  app.get('/api/customers/:customerId/accounts', async (req, res) => {
    try {
      const accounts = await resolvedServices.listAccounts(req.params.customerId);
      return res.json({ accounts });
    } catch (error) {
      return handleApiError(error, res, logger, 'Failed to list accounts');
    }
  });

  app.post('/api/transfers', async (req, res) => {
    try {
      const transfer = await resolvedServices.transferMoney(req.body);
      return res.status(201).json(transfer);
    } catch (error) {
      return handleApiError(error, res, logger, 'Failed to transfer money');
    }
  });

  app.get('/api/customers/:customerId/accounts/:accountId/transactions', async (req, res) => {
    try {
      const transactions = await resolvedServices.listTransactions(
        req.params.customerId,
        req.params.accountId,
      );
      return res.json({ transactions });
    } catch (error) {
      return handleApiError(error, res, logger, 'Failed to list transactions');
    }
  });

  app.get('/docs/openapi.json', (_req, res) => {
    res.json(openApiDocument);
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

function handleApiError(error, res, logger, logMessage) {
  if (error instanceof BankingError) {
    return res.status(error.status).json({ error: error.message });
  }

  logger.error(logMessage, error);
  return res.status(500).json({ error: 'Internal server error.' });
}

module.exports = {
  createApp,
  createDefaultServices,
  resolveCorsOrigin,
  handleApiError,
};
