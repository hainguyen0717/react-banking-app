const { getPrismaClient } = require('../lib/prisma');
const { BankingError } = require('../errors/BankingError');

const TRANSFER_SELECT = {
  id: true,
  sourceAccountId: true,
  destinationAccountId: true,
  amountCents: true,
  description: true,
  createdAt: true,
};

function validateTransferInput({ customerId, sourceAccountId, destinationAccountNumber, amountCents, description } = {}) {
  if (typeof customerId !== 'string' || !customerId.trim()) {
    throw new BankingError(400, 'INVALID_CUSTOMER', 'Customer ID is required.');
  }
  if (typeof sourceAccountId !== 'string' || !sourceAccountId.trim()) {
    throw new BankingError(400, 'INVALID_SOURCE_ACCOUNT', 'Source account ID is required.');
  }
  if (typeof destinationAccountNumber !== 'string' || !destinationAccountNumber.trim()) {
    throw new BankingError(400, 'INVALID_DESTINATION_ACCOUNT', 'Destination account number is required.');
  }
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new BankingError(400, 'INVALID_AMOUNT', 'Amount must be a positive whole number of cents.');
  }
  if (description !== undefined && description !== null && typeof description !== 'string') {
    throw new BankingError(400, 'INVALID_DESCRIPTION', 'Description must be text.');
  }

  const normalizedDescription = typeof description === 'string' ? description.trim() : null;
  if (normalizedDescription && normalizedDescription.length > 140) {
    throw new BankingError(400, 'INVALID_DESCRIPTION', 'Description must be 140 characters or fewer.');
  }

  return {
    customerId: customerId.trim(),
    sourceAccountId: sourceAccountId.trim(),
    destinationAccountNumber: destinationAccountNumber.trim().toUpperCase(),
    amountCents,
    description: normalizedDescription || null,
  };
}

async function executeTransferInTransaction(tx, {
  customerId,
  sourceAccountId,
  destinationAccountId,
  destinationAccountNumber,
  amountCents,
  description,
}) {
  const source = await tx.account.findUnique({
    where: { id: sourceAccountId },
    select: { id: true, customerId: true, coOwnerCustomerId: true, accountNumber: true, balanceCents: true },
  });
  if (!source) throw new BankingError(404, 'SOURCE_ACCOUNT_NOT_FOUND', 'Source account was not found.');
  if (source.customerId !== customerId && source.coOwnerCustomerId !== customerId) {
    throw new BankingError(403, 'SOURCE_ACCOUNT_FORBIDDEN', 'The source account does not belong to this customer.');
  }

  const destination = await tx.account.findUnique({
    where: destinationAccountId ? { id: destinationAccountId } : { accountNumber: destinationAccountNumber },
    select: { id: true, accountNumber: true },
  });
  if (!destination) throw new BankingError(404, 'DESTINATION_ACCOUNT_NOT_FOUND', 'Destination account was not found.');
  if (destination.id === source.id) {
    throw new BankingError(400, 'SELF_TRANSFER', 'Source and destination accounts must be different.');
  }

  if (typeof tx.account.updateMany === 'function') {
    const debited = await tx.account.updateMany({
      where: { id: source.id, balanceCents: { gte: amountCents } },
      data: { balanceCents: { decrement: amountCents } },
    });
    if (debited.count !== 1) {
      throw new BankingError(409, 'INSUFFICIENT_FUNDS', 'The source account has insufficient funds.');
    }
  } else {
    // Compatibility for lightweight unit-test transaction doubles.
    if (source.balanceCents < amountCents) {
      throw new BankingError(409, 'INSUFFICIENT_FUNDS', 'The source account has insufficient funds.');
    }
    await tx.account.update({ where: { id: source.id }, data: { balanceCents: { decrement: amountCents } } });
  }
  await tx.account.update({
    where: { id: destination.id },
    data: { balanceCents: { increment: amountCents } },
  });
  const transfer = await tx.transfer.create({
    data: { sourceAccountId: source.id, destinationAccountId: destination.id, amountCents, description },
    select: TRANSFER_SELECT,
  });
  return {
    ...transfer,
    sourceAccountNumber: source.accountNumber,
    destinationAccountNumber: destination.accountNumber,
  };
}

function createTransferService({ prisma = getPrismaClient() } = {}) {
  const transferMoney = async (input) => {
    const valid = validateTransferInput(input);

    return prisma.$transaction(async (tx) => {
      return executeTransferInTransaction(tx, valid);
    });
  };

  const listTransactions = async (customerId, accountId) => {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, customerId: true, coOwnerCustomerId: true },
    });
    if (!account) {
      throw new BankingError(404, 'ACCOUNT_NOT_FOUND', 'Account was not found.');
    }
    if (account.customerId !== customerId && account.coOwnerCustomerId !== customerId) {
      throw new BankingError(403, 'ACCOUNT_FORBIDDEN', 'This account does not belong to the customer.');
    }

    const transfers = await prisma.transfer.findMany({
      where: {
        OR: [{ sourceAccountId: accountId }, { destinationAccountId: accountId }],
      },
      include: {
        sourceAccount: { select: { accountNumber: true } },
        destinationAccount: { select: { accountNumber: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return transfers.map((transfer) => {
      const sent = transfer.sourceAccountId === accountId;
      return {
        id: transfer.id,
        direction: sent ? 'SENT' : 'RECEIVED',
        amountCents: transfer.amountCents,
        description: transfer.description,
        counterpartyAccountNumber: sent
          ? transfer.destinationAccount.accountNumber
          : transfer.sourceAccount.accountNumber,
        createdAt: transfer.createdAt,
      };
    });
  };

  return { transferMoney, listTransactions };
}

const defaultService = createTransferService();

module.exports = {
  TRANSFER_SELECT,
  validateTransferInput,
  executeTransferInTransaction,
  createTransferService,
  transferMoney: defaultService.transferMoney,
  listTransactions: defaultService.listTransactions,
};
