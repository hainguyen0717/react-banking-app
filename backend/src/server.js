const dotenv = require('dotenv');

dotenv.config();

const { createApp } = require('./createApp');
const { getPrismaClient } = require('./lib/prisma');
const { createScheduledTransferService } = require('./services/scheduledTransferService');
const { createScheduledTransferWorker } = require('./workers/scheduledTransferWorker');
const { getScheduledTransferConfig } = require('./config/scheduledTransferConfig');

const prisma = getPrismaClient();
const app = createApp({ prisma });
const scheduledTransferWorker = createScheduledTransferWorker({
  processDueScheduledTransfers: createScheduledTransferService({ prisma }).processDueScheduledTransfers,
  pollIntervalMs: getScheduledTransferConfig().pollIntervalMs,
  logger: console,
});

const PORT = Number(process.env.PORT || 3001);

const server = app.listen(PORT, () => {
  console.log(`Backend service listening on port ${PORT}`);
});
scheduledTransferWorker.start();

const shutdown = async () => {
  console.log('Shutting down backend service...');
  await scheduledTransferWorker.stop();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app };
