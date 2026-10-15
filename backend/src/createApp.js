const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const customerService = require('./services/customerService');
const accountService = require('./services/accountService');
const transferService = require('./services/transferService');
const sessionService = require('./services/sessionService');
const scheduledTransferService = require('./services/scheduledTransferService');
const cardService = require('./services/cardService');
const { BankingError } = require('./errors/BankingError');
const { getPrismaClient } = require('./lib/prisma');
const { getSessionConfig, getFrontendOrigins } = require('./config/sessionConfig');
const { createAuthenticateMiddleware } = require('./middleware/authenticate');
const { createTrustedOriginMiddleware } = require('./middleware/trustedOrigin');
const { readSessionCookie, serializeSessionCookie, serializeClearedSessionCookie } = require('./http/sessionCookie');
const openApiDocument = require('./docs/openapi.json');

const LOCAL_FRONTEND_ORIGINS = getFrontendOrigins();
const SWAGGER_UI_OPTIONS = {
  customSiteTitle: 'Express Bank Demo API',
  customCss: '',
  swaggerOptions: {
    url: '/docs/openapi.json',
    withCredentials: true,
    persistAuthorization: false,
  },
};

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
      const message = `${req.method} ${req.path} -> ${res.statusCode} (${durationMs.toFixed(1)} ms)`;

      if (res.statusCode >= 500) {
        logger.error(message);
      } else {
        logger.info(message);
      }
    });

    next();
  };
}

function createDefaultServices(prisma, sessionConfig = getSessionConfig()) {
  return {
    ...customerService.createCustomerService({ prisma }),
    ...accountService.createAccountService({ prisma }),
    ...transferService.createTransferService({ prisma }),
    ...sessionService.createSessionService({ prisma, config: sessionConfig }),
    ...scheduledTransferService.createScheduledTransferService({ prisma }),
    ...cardService.createCardService({ prisma }),
  };
}

function resolveCorsOrigin(origin, callback, frontendOrigins = LOCAL_FRONTEND_ORIGINS) {
  // Requests without an Origin header are non-browser/same-origin clients and
  // do not need a CORS response header.
  callback(null, !origin || frontendOrigins.has(origin));
}

function createApp({
  prisma = getPrismaClient(),
  services = {},
  logger = defaultLogger,
  sessionConfig = getSessionConfig(),
  frontendOrigins = getFrontendOrigins(),
  isProduction = process.env.NODE_ENV === 'production',
} = {}) {
  const app = express();
  const resolvedServices = {
    ...createDefaultServices(prisma, sessionConfig),
    ...services,
  };
  const authenticate = createAuthenticateMiddleware({
    resolveSession: resolvedServices.resolveSession,
    isProduction,
  });
  const trustedOrigin = createTrustedOriginMiddleware(frontendOrigins);

  app.use(cors({ origin: (origin, callback) => resolveCorsOrigin(origin, callback, frontendOrigins), credentials: true }));
  app.use(express.json());
  app.use(createRequestLogger(logger));

  app.post('/api/login', trustedOrigin, async (req, res) => {
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

      const currentCookie = readSessionCookie(req.headers.cookie);
      if (!currentCookie.malformed && currentCookie.token) {
        const currentAuth = await resolvedServices.resolveSession(currentCookie.token);
        if (currentAuth) await resolvedServices.deleteSession(currentAuth.session.id);
      }
      const created = await resolvedServices.createSession(customer.id);
      res.setHeader('Set-Cookie', serializeSessionCookie(
        created.token,
        created.session.absoluteExpiresAt,
        new Date(),
        isProduction,
      ));
      logger.info(`Customer ${customer.id} authenticated successfully.`);
      return res.json(customer);
    } catch (error) {
      logger.error('Failed to authenticate customer', error);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  });

  app.post('/api/customers', trustedOrigin, async (req, res) => {
    try {
      const customer = await resolvedServices.createCustomer(req.body);
      return res.status(201).json(customer);
    } catch (error) {
      return handleApiError(error, res, logger, 'Failed to create customer');
    }
  });

  app.get('/api/session', authenticate, (req, res) => {
    res.json(req.auth.customer);
  });

  app.put('/api/profile', authenticate, trustedOrigin, async (req, res) => {
    try {
      return res.json(await resolvedServices.updateProfile(req.auth.customer.id, req.body));
    } catch (error) {
      return handleApiError(error, res, logger, 'Failed to update profile');
    }
  });

  app.post('/api/logout', authenticate, trustedOrigin, async (req, res) => {
    try {
      await resolvedServices.deleteSession(req.auth.session.id);
      res.setHeader('Set-Cookie', serializeClearedSessionCookie(isProduction));
      return res.status(204).send();
    } catch (error) {
      return handleApiError(error, res, logger, 'Failed to log out');
    }
  });

  app.post('/api/accounts', authenticate, trustedOrigin, async (req, res) => {
    try {
      const account = await resolvedServices.createAccount(req.auth.customer.id, req.body);
      return res.status(201).json(account);
    } catch (error) {
      return handleApiError(error, res, logger, 'Failed to create account');
    }
  });

  app.post('/api/joint-accounts', authenticate, trustedOrigin, async (req, res) => {
    try {
      const account = await resolvedServices.createJointAccount(req.auth.customer.id, req.body);
      return res.status(201).json(account);
    } catch (error) {
      return handleApiError(error, res, logger, 'Failed to create joint account');
    }
  });

  app.get('/api/accounts', authenticate, async (req, res) => {
    try {
      const accounts = await resolvedServices.listAccounts(req.auth.customer.id);
      return res.json({ accounts });
    } catch (error) {
      return handleApiError(error, res, logger, 'Failed to list accounts');
    }
  });

  app.post('/api/transfers', authenticate, trustedOrigin, async (req, res) => {
    try {
      const transfer = await resolvedServices.transferMoney({
        sourceAccountId: req.body?.sourceAccountId,
        destinationAccountNumber: req.body?.destinationAccountNumber,
        amountCents: req.body?.amountCents,
        description: req.body?.description,
        customerId: req.auth.customer.id,
      });
      return res.status(201).json(transfer);
    } catch (error) {
      return handleApiError(error, res, logger, 'Failed to transfer money');
    }
  });

  app.post('/api/scheduled-transfers', authenticate, trustedOrigin, async (req, res) => {
    try {
      const schedule = await resolvedServices.createScheduledTransfer(req.auth.customer.id, req.body);
      return res.status(201).json(schedule);
    } catch (error) {
      return handleApiError(error, res, logger, 'Failed to schedule transfer');
    }
  });

  app.get('/api/scheduled-transfers', authenticate, async (req, res) => {
    try {
      return res.json({ scheduledTransfers: await resolvedServices.listScheduledTransfers(req.auth.customer.id) });
    } catch (error) {
      return handleApiError(error, res, logger, 'Failed to list scheduled transfers');
    }
  });

  app.get('/api/cards', authenticate, async (req, res) => {
    try {
      return res.json({ cards: await resolvedServices.listCards(req.auth.customer.id) });
    } catch (error) {
      return handleApiError(error, res, logger, 'Failed to list cards');
    }
  });

  app.post('/api/cards', authenticate, trustedOrigin, async (req, res) => {
    try {
      return res.status(201).json(await resolvedServices.createCard(req.auth.customer.id, req.body));
    } catch (error) {
      return handleApiError(error, res, logger, 'Failed to create card');
    }
  });

  app.get('/api/cards/:cardId', authenticate, async (req, res) => {
    try {
      return res.json(await resolvedServices.getCard(req.auth.customer.id, req.params.cardId));
    } catch (error) {
      return handleApiError(error, res, logger, 'Failed to get card');
    }
  });

  for (const [action, serviceName] of [['lock', 'lockCard'], ['unlock', 'unlockCard'], ['disable', 'disableCard']]) {
    app.post(`/api/cards/:cardId/${action}`, authenticate, trustedOrigin, async (req, res) => {
      try {
        return res.json(await resolvedServices[serviceName](req.auth.customer.id, req.params.cardId));
      } catch (error) {
        return handleApiError(error, res, logger, `Failed to ${action} card`);
      }
    });
  }

  app.get('/api/accounts/:accountId/transactions', authenticate, async (req, res) => {
    try {
      const transactions = await resolvedServices.listTransactions(
        req.auth.customer.id,
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

  app.get(/^\/docs$/, (_req, res) => {
    res.redirect(308, '/docs/');
  });

  app.use(
    '/docs/',
    swaggerUi.serveFiles(null, SWAGGER_UI_OPTIONS),
    swaggerUi.setup(null, SWAGGER_UI_OPTIONS),
  );

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

  app.use((error, _req, res, _next) => {
    logger.error('Unhandled API error', error);
    res.status(500).json({ error: 'Internal server error.' });
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
  createRequestLogger,
  createDefaultServices,
  resolveCorsOrigin,
  handleApiError,
  SWAGGER_UI_OPTIONS,
};
