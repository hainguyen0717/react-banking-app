const { randomInt } = require('node:crypto');
const { getPrismaClient } = require('../lib/prisma');
const { BankingError } = require('../errors/BankingError');
const { getDefaultAccountBalanceCents } = require('../config/accountConfig');

const ACCOUNT_TYPES = Object.freeze(['EVERYDAY', 'SAVINGS', 'BUSINESS']);

const ACCOUNT_SELECT = {
  id: true,
  accountNumber: true,
  customerId: true,
  type: true,
  displayName: true,
  balanceCents: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
};

function generateAccountNumber() {
  return `EXB-${randomInt(1_000_000_000).toString().padStart(9, '0')}`;
}

function validateAccountInput({ type, displayName } = {}) {
  if (!ACCOUNT_TYPES.includes(type)) {
    throw new BankingError(400, 'INVALID_ACCOUNT_TYPE', `Account type must be one of: ${ACCOUNT_TYPES.join(', ')}.`);
  }

  const normalizedDisplayName = typeof displayName === 'string' ? displayName.trim() : null;
  if (normalizedDisplayName && normalizedDisplayName.length > 80) {
    throw new BankingError(400, 'INVALID_DISPLAY_NAME', 'Display name must be 80 characters or fewer.');
  }

  return { type, displayName: normalizedDisplayName || null };
}

function createAccountService({
  prisma = getPrismaClient(),
  openingBalanceCents = getDefaultAccountBalanceCents(),
  accountNumberGenerator = generateAccountNumber,
} = {}) {
  if (!Number.isSafeInteger(openingBalanceCents) || openingBalanceCents < 0) {
    throw new Error('Opening balance must be a non-negative safe integer.');
  }

  const assertActiveCustomer = async (customerId) => {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, isActive: true },
    });

    if (!customer) {
      throw new BankingError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
    }
    if (!customer.isActive) {
      throw new BankingError(409, 'CUSTOMER_INACTIVE', 'Inactive customers cannot create or view accounts.');
    }
    return customer;
  };

  const createAccount = async (customerId, input) => {
    const valid = validateAccountInput(input);
    await assertActiveCustomer(customerId);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await prisma.account.create({
          data: {
            accountNumber: accountNumberGenerator(),
            customerId,
            type: valid.type,
            displayName: valid.displayName,
            balanceCents: openingBalanceCents,
            currency: 'AUD',
          },
          select: ACCOUNT_SELECT,
        });
      } catch (error) {
        if (error?.code !== 'P2002' || attempt === 4) {
          throw error;
        }
      }
    }
    throw new Error('Unable to allocate a unique account number.');
  };

  const listAccounts = async (customerId) => {
    await assertActiveCustomer(customerId);
    return prisma.account.findMany({
      where: { customerId },
      select: ACCOUNT_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  };

  return { createAccount, listAccounts };
}

const defaultService = createAccountService();

module.exports = {
  ACCOUNT_TYPES,
  ACCOUNT_SELECT,
  generateAccountNumber,
  validateAccountInput,
  createAccountService,
  createAccount: defaultService.createAccount,
  listAccounts: defaultService.listAccounts,
};
