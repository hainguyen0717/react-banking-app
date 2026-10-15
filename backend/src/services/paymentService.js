const { getPrismaClient } = require('../lib/prisma');
const { BankingError } = require('../errors/BankingError');
const { executeTransferInTransaction } = require('./transferService');

const PAYMENT_METHODS = new Set(['BANK_ACCOUNT', 'PAYID', 'BPAY']);
const METHOD_FIELDS = {
  BANK_ACCOUNT: ['destinationAccountNumber'],
  PAYID: ['payId'],
  BPAY: ['billerCode', 'customerReference'],
};
const ALL_METHOD_FIELDS = Object.values(METHOD_FIELDS).flat();

function validatePaymentInput(input = {}) {
  const method = typeof input.method === 'string' ? input.method.trim().toUpperCase() : '';
  if (!PAYMENT_METHODS.has(method)) {
    throw new BankingError(400, 'INVALID_PAYMENT_METHOD', 'Choose bank account, PayID or BPAY.');
  }
  if (typeof input.sourceAccountId !== 'string' || !input.sourceAccountId.trim()) {
    throw new BankingError(400, 'INVALID_SOURCE_ACCOUNT', 'Source account is required.');
  }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new BankingError(400, 'INVALID_AMOUNT', 'Amount must be a positive whole number of cents.');
  }
  if (input.description !== undefined && input.description !== null && typeof input.description !== 'string') {
    throw new BankingError(400, 'INVALID_DESCRIPTION', 'Description must be text.');
  }
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length > 140) {
    throw new BankingError(400, 'INVALID_DESCRIPTION', 'Description must be 140 characters or fewer.');
  }
  for (const field of ALL_METHOD_FIELDS) {
    if (!METHOD_FIELDS[method].includes(field) && input[field] !== undefined && input[field] !== null && input[field] !== '') {
      throw new BankingError(400, 'IRRELEVANT_PAYMENT_FIELD', `${field} is not valid for ${method}.`);
    }
  }

  const valid = {
    method,
    sourceAccountId: input.sourceAccountId.trim(),
    amountCents: input.amountCents,
    description: description || null,
  };
  if (method === 'BANK_ACCOUNT') {
    if (typeof input.destinationAccountNumber !== 'string' || !input.destinationAccountNumber.trim()) {
      throw new BankingError(400, 'INVALID_DESTINATION_ACCOUNT', 'Destination account number is required.');
    }
    valid.destinationAccountNumber = input.destinationAccountNumber.trim().toUpperCase();
  } else if (method === 'PAYID') {
    if (typeof input.payId !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.payId.trim())) {
      throw new BankingError(400, 'INVALID_PAYID', 'Enter a valid email PayID.');
    }
    valid.payId = input.payId.trim().toLowerCase();
  } else {
    if (typeof input.billerCode !== 'string' || !/^\d+$/.test(input.billerCode.trim())) {
      throw new BankingError(400, 'INVALID_BILLER_CODE', 'BPAY biller code must contain digits only.');
    }
    if (typeof input.customerReference !== 'string' || !/^\d+$/.test(input.customerReference.trim())) {
      throw new BankingError(400, 'INVALID_CUSTOMER_REFERENCE', 'BPAY customer reference must contain digits only.');
    }
    valid.billerCode = input.billerCode.trim();
    valid.customerReference = input.customerReference.trim();
  }
  return valid;
}

function owns(account, customerId) {
  return account.customerId === customerId || account.coOwnerCustomerId === customerId;
}

function accountLabel(account) {
  return account.displayName?.trim() || `Express Bank account ending ${account.accountNumber.slice(-4)}`;
}

async function resolveWithClient(client, customerId, input) {
  const valid = validatePaymentInput(input);
  if (typeof customerId !== 'string' || !customerId.trim()) {
    throw new BankingError(400, 'INVALID_CUSTOMER', 'Customer ID is required.');
  }
  const source = await client.account.findUnique({
    where: { id: valid.sourceAccountId },
    select: { id: true, customerId: true, coOwnerCustomerId: true, accountNumber: true, balanceCents: true },
  });
  if (!source) throw new BankingError(404, 'SOURCE_ACCOUNT_NOT_FOUND', 'Source account was not found.');
  if (!owns(source, customerId)) {
    throw new BankingError(403, 'SOURCE_ACCOUNT_FORBIDDEN', 'The source account does not belong to this customer.');
  }
  if (source.balanceCents < valid.amountCents) {
    throw new BankingError(409, 'INSUFFICIENT_FUNDS', 'The source account has insufficient funds.');
  }

  const resolution = { ...valid, source };
  if (valid.method === 'BANK_ACCOUNT') {
    const destination = await client.account.findUnique({
      where: { accountNumber: valid.destinationAccountNumber },
      select: { id: true, customerId: true, coOwnerCustomerId: true, accountNumber: true, displayName: true },
    });
    if (!destination) throw new BankingError(404, 'DESTINATION_ACCOUNT_NOT_FOUND', 'Destination account was not found.');
    if (owns(destination, customerId)) {
      throw new BankingError(400, 'SELF_PAYMENT', 'Payments to an account you own are not allowed.');
    }
    resolution.destination = destination;
    resolution.payeeName = accountLabel(destination);
  } else if (valid.method === 'PAYID') {
    const entry = await client.payIdDirectoryEntry.findUnique({
      where: { value: valid.payId },
      include: { account: { select: { id: true, customerId: true, coOwnerCustomerId: true } } },
    });
    if (!entry || !entry.isActive) throw new BankingError(404, 'PAYID_NOT_FOUND', 'No active recipient was found for that PayID.');
    if (owns(entry.account, customerId)) {
      throw new BankingError(400, 'SELF_PAYMENT', 'Payments to a PayID linked to an account you own are not allowed.');
    }
    resolution.payIdEntry = entry;
    resolution.destination = entry.account;
    resolution.payeeName = entry.displayName;
  } else {
    const biller = await client.bpayBiller.findUnique({ where: { billerCode: valid.billerCode } });
    if (!biller || !biller.isActive) throw new BankingError(404, 'BPAY_BILLER_NOT_FOUND', 'No active BPAY biller was found for that code.');
    if (valid.customerReference.length !== biller.referenceLength) {
      throw new BankingError(400, 'INVALID_CUSTOMER_REFERENCE', `Customer reference must be exactly ${biller.referenceLength} digits for this biller.`);
    }
    resolution.biller = biller;
    resolution.payeeName = biller.name;
  }
  return resolution;
}

function toReview(resolved) {
  const review = {
    method: resolved.method,
    sourceAccountNumber: resolved.source.accountNumber,
    amountCents: resolved.amountCents,
    description: resolved.description,
    payeeName: resolved.payeeName,
  };
  if (resolved.method === 'BANK_ACCOUNT') review.destinationAccountNumber = resolved.destinationAccountNumber;
  if (resolved.method === 'PAYID') review.payId = resolved.payId;
  if (resolved.method === 'BPAY') {
    review.billerCode = resolved.billerCode;
    review.customerReference = resolved.customerReference;
  }
  return review;
}

function toReceipt(payment) {
  return {
    id: payment.id,
    method: payment.method,
    sourceAccountNumber: payment.sourceAccountNumberSnapshot,
    amountCents: payment.amountCents,
    description: payment.description,
    payeeName: payment.payeeNameSnapshot,
    destinationAccountNumber: payment.destinationAccountNumberSnapshot,
    payId: payment.payIdSnapshot,
    billerCode: payment.billerCodeSnapshot,
    customerReference: payment.customerReference,
    createdAt: payment.createdAt,
  };
}

function createPaymentService({ prisma = getPrismaClient() } = {}) {
  const resolvePayment = async (customerId, input) => toReview(await resolveWithClient(prisma, customerId, input));

  const createPayment = async (customerId, input) => prisma.$transaction(async (tx) => {
    const resolved = await resolveWithClient(tx, customerId, input);
    let transfer = null;
    if (resolved.method === 'BANK_ACCOUNT' || resolved.method === 'PAYID') {
      transfer = await executeTransferInTransaction(tx, {
        customerId,
        sourceAccountId: resolved.source.id,
        destinationAccountId: resolved.destination.id,
        amountCents: resolved.amountCents,
        description: resolved.description,
      });
    } else {
      const debited = await tx.account.updateMany({
        where: { id: resolved.source.id, balanceCents: { gte: resolved.amountCents } },
        data: { balanceCents: { decrement: resolved.amountCents } },
      });
      if (debited.count !== 1) {
        throw new BankingError(409, 'INSUFFICIENT_FUNDS', 'The source account has insufficient funds.');
      }
    }

    const payment = await tx.payment.create({
      data: {
        customerId,
        sourceAccountId: resolved.source.id,
        method: resolved.method,
        amountCents: resolved.amountCents,
        description: resolved.description,
        transferId: transfer?.id || null,
        payIdDirectoryEntryId: resolved.payIdEntry?.id || null,
        bpayBillerId: resolved.biller?.id || null,
        customerReference: resolved.customerReference || null,
        sourceAccountNumberSnapshot: resolved.source.accountNumber,
        payeeNameSnapshot: resolved.payeeName,
        destinationAccountNumberSnapshot: resolved.method === 'BANK_ACCOUNT' ? resolved.destinationAccountNumber : null,
        payIdSnapshot: resolved.method === 'PAYID' ? resolved.payId : null,
        billerCodeSnapshot: resolved.method === 'BPAY' ? resolved.billerCode : null,
      },
    });
    return toReceipt(payment);
  });

  return { resolvePayment, createPayment };
}

const defaultService = createPaymentService();

module.exports = {
  validatePaymentInput,
  resolveWithClient,
  toReview,
  toReceipt,
  createPaymentService,
  resolvePayment: defaultService.resolvePayment,
  createPayment: defaultService.createPayment,
};
