const express = require('express');
const dotenv = require('dotenv');
const { getPrismaClient } = require('./lib/prisma');
const { authenticateCustomer } = require('./services/customerService');

dotenv.config();

const prisma = getPrismaClient();
const app = express();

app.use(express.json());

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const customer = await authenticateCustomer(email, password);

    if (!customer) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    return res.json(customer);
  } catch (error) {
    console.error('Failed to authenticate customer', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Database health check failed', error);
    res.status(503).json({ status: 'unhealthy' });
  }
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Backend service listening on port ${PORT}`);
});

const shutdown = async () => {
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
