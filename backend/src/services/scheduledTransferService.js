const { getPrismaClient } = require('../lib/prisma');
const { BankingError } = require('../errors/BankingError');
const { executeTransferInTransaction } = require('./transferService');

const SCHEDULE_SELECT = {
  id: true,
  sourceAccountId: true,
  destinationAccountId: true,
  amountCents: true,
  description: true,
  scheduledFor: true,
  status: true,
  failureReason: true,
  processedAt: true,
  transferId: true,
  createdAt: true,
  updatedAt: true,
  sourceAccount: { select: { accountNumber: true } },
  destinationAccount: { select: { accountNumber: true } },
};

function mapSchedule(schedule) {
  const { sourceAccount, destinationAccount, ...safe } = schedule;
  return {
    ...safe,
    sourceAccountNumber: sourceAccount?.accountNumber,
    destinationAccountNumber: destinationAccount?.accountNumber,
  };
}

function validateScheduleInput(input = {}, now = new Date()) {
  const { sourceAccountId, destinationAccountNumber, amountCents, description, scheduledFor } = input;
  if (typeof sourceAccountId !== 'string' || !sourceAccountId.trim()) {
    throw new BankingError(400, 'INVALID_SOURCE_ACCOUNT', 'Source account ID is required.');
  }
  if (typeof destinationAccountNumber !== 'string' || !destinationAccountNumber.trim()) {
    throw new BankingError(400, 'INVALID_DESTINATION_ACCOUNT', 'Destination account number is required.');
  }
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new BankingError(400, 'INVALID_AMOUNT', 'Amount must be a positive whole number of cents.');
  }
  const normalizedDescription = typeof description === 'string' ? description.trim() : null;
  if (description !== undefined && description !== null && typeof description !== 'string') {
    throw new BankingError(400, 'INVALID_DESCRIPTION', 'Description must be text.');
  }
  if (normalizedDescription && normalizedDescription.length > 140) {
    throw new BankingError(400, 'INVALID_DESCRIPTION', 'Description must be 140 characters or fewer.');
  }
  if (typeof scheduledFor !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(scheduledFor)) {
    throw new BankingError(400, 'INVALID_SCHEDULED_FOR', 'Scheduled time must be a valid ISO-8601 UTC date and time.');
  }
  const parsed = new Date(scheduledFor);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== scheduledFor) {
    throw new BankingError(400, 'INVALID_SCHEDULED_FOR', 'Scheduled time must be a valid ISO-8601 UTC date and time.');
  }
  if (parsed <= now) {
    throw new BankingError(400, 'SCHEDULED_FOR_NOT_FUTURE', 'Scheduled time must be in the future.');
  }
  return {
    sourceAccountId: sourceAccountId.trim(),
    destinationAccountNumber: destinationAccountNumber.trim().toUpperCase(),
    amountCents,
    description: normalizedDescription || null,
    scheduledFor: parsed,
  };
}

function createScheduledTransferService({ prisma = getPrismaClient(), now = () => new Date() } = {}) {
  const createScheduledTransfer = async (customerId, input) => {
    const valid = validateScheduleInput(input, now());
    const [source, destination] = await Promise.all([
      prisma.account.findUnique({
        where: { id: valid.sourceAccountId },
        select: { id: true, customerId: true, coOwnerCustomerId: true, balanceCents: true },
      }),
      prisma.account.findUnique({
        where: { accountNumber: valid.destinationAccountNumber },
        select: { id: true },
      }),
    ]);
    if (!source) throw new BankingError(404, 'SOURCE_ACCOUNT_NOT_FOUND', 'Source account was not found.');
    if (source.customerId !== customerId && source.coOwnerCustomerId !== customerId) {
      throw new BankingError(403, 'SOURCE_ACCOUNT_FORBIDDEN', 'The source account does not belong to this customer.');
    }
    if (!destination) throw new BankingError(404, 'DESTINATION_ACCOUNT_NOT_FOUND', 'Destination account was not found.');
    if (source.id === destination.id) throw new BankingError(400, 'SELF_TRANSFER', 'Source and destination accounts must be different.');
    if (source.balanceCents < valid.amountCents) {
      throw new BankingError(409, 'INSUFFICIENT_FUNDS', 'The source account has insufficient funds.');
    }
    const schedule = await prisma.scheduledTransfer.create({
      data: {
        customerId,
        sourceAccountId: source.id,
        destinationAccountId: destination.id,
        amountCents: valid.amountCents,
        description: valid.description,
        scheduledFor: valid.scheduledFor,
      },
      select: SCHEDULE_SELECT,
    });
    return mapSchedule(schedule);
  };

  const listScheduledTransfers = async (customerId) => {
    const schedules = await prisma.scheduledTransfer.findMany({
      where: { customerId },
      select: SCHEDULE_SELECT,
      orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
    });
    return schedules.map(mapSchedule);
  };

  const processOne = async (id, processTime) => prisma.$transaction(async (tx) => {
    const claimed = await tx.scheduledTransfer.updateMany({
      where: { id, status: 'PENDING', scheduledFor: { lte: processTime } },
      data: { status: 'PROCESSING' },
    });
    if (claimed.count !== 1) return null;
    const schedule = await tx.scheduledTransfer.findUnique({ where: { id } });
    try {
      const transfer = await executeTransferInTransaction(tx, {
        customerId: schedule.customerId,
        sourceAccountId: schedule.sourceAccountId,
        destinationAccountId: schedule.destinationAccountId,
        amountCents: schedule.amountCents,
        description: schedule.description,
      });
      await tx.scheduledTransfer.update({
        where: { id },
        data: { status: 'COMPLETED', processedAt: processTime, transferId: transfer.id, failureReason: null },
      });
      return 'COMPLETED';
    } catch (error) {
      if (!(error instanceof BankingError)) throw error;
      await tx.scheduledTransfer.update({
        where: { id },
        data: { status: 'FAILED', processedAt: processTime, failureReason: error.code },
      });
      return 'FAILED';
    }
  });

  const processDueScheduledTransfers = async () => {
    const processTime = now();
    const due = await prisma.scheduledTransfer.findMany({
      where: { status: 'PENDING', scheduledFor: { lte: processTime } },
      select: { id: true },
      orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
    });
    const results = [];
    for (const { id } of due) results.push(await processOne(id, processTime));
    return results.filter(Boolean);
  };

  return { createScheduledTransfer, listScheduledTransfers, processDueScheduledTransfers };
}

module.exports = { SCHEDULE_SELECT, mapSchedule, validateScheduleInput, createScheduledTransferService };
