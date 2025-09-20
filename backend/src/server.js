const dotenv = require('dotenv');
const { createApp } = require('./createApp');
const { getPrismaClient } = require('./lib/prisma');

dotenv.config();

const prisma = getPrismaClient();
const app = createApp({ prisma });

const PORT = Number(process.env.PORT || 3001);

const server = app.listen(PORT, () => {
  console.log(`Backend service listening on port ${PORT}`);
});

const shutdown = async () => {
  console.log('Shutting down backend service...');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app };
