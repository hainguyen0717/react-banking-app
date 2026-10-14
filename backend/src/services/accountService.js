const { randomInt } = require('node:crypto');
const { getPrismaClient } = require('../lib/prisma');
const { BankingError } = require('../errors/BankingError');
const { getDefaultAccountBalanceCents } = require('../config/accountConfig');
const { normalizeEmail } = require('./customerService');

const ACCOUNT_TYPES = Object.freeze(['EVERYDAY', 'SAVINGS', 'BUSINESS']);
const OWNERSHIP_TYPES = Object.freeze(['SINGLE', 'JOINT']);
const ACCOUNT_OWNER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
};

const ACCOUNT_SELECT = {
  id: true,
  accountNumber: true,
  customerId: true,
  ownershipType: true,
  type: true,
  displayName: true,
  balanceCents: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
  primaryOwner: { select: ACCOUNT_OWNER_SELECT },
  coOwner: { select: ACCOUNT_OWNER_SELECT },
};

function mapAccount(account) {
  const { primaryOwner, coOwner, ...safeAccount } = account;
  return {
    ...safeAccount,
    owners: [primaryOwner, coOwner].filter(Boolean),
  };
}

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

function validateJointAccountInput(input = {}) {
  const account = validateAccountInput(input);
  const coOwnerEmail = normalizeEmail(input.coOwnerEmail);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(coOwnerEmail)) {
    throw new BankingError(400, 'INVALID_CO_OWNER_EMAIL', 'Enter a valid registered co-owner email address.');
  }

  return { ...account, coOwnerEmail };
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
      select: { ...ACCOUNT_OWNER_SELECT, isActive: true },
    });

    if (!customer) {
      throw new BankingError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
    }
    if (!customer.isActive) {
      throw new BankingError(409, 'CUSTOMER_INACTIVE', 'Inactive customers cannot create or view accounts.');
    }
    return customer;
  };

  const createWithUniqueNumber = async (data) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const account = await prisma.account.create({
          data: { ...data, accountNumber: accountNumberGenerator() },
          select: ACCOUNT_SELECT,
        });
        return mapAccount(account);
      } catch (error) {
        if (error?.code !== 'P2002' || attempt === 4) {
          throw error;
        }
      }
    }
    throw new Error('Unable to allocate a unique account number.');
  };

  const createAccount = async (customerId, input) => {
    const valid = validateAccountInput(input);
    await assertActiveCustomer(customerId);

    return createWithUniqueNumber({
      customerId,
      coOwnerCustomerId: null,
      ownershipType: 'SINGLE',
      type: valid.type,
      displayName: valid.displayName,
      balanceCents: openingBalanceCents,
      currency: 'AUD',
    });
  };

  const createJointAccount = async (customerId, input) => {
    const valid = validateJointAccountInput(input);
    const primaryOwner = await assertActiveCustomer(customerId);
    const coOwner = await prisma.customer.findUnique({
      where: { email: valid.coOwnerEmail },
      select: { ...ACCOUNT_OWNER_SELECT, isActive: true },
    });

    if (!coOwner) {
      throw new BankingError(404, 'CO_OWNER_NOT_FOUND', 'No registered customer was found for that co-owner email.');
    }
    if (coOwner.id === primaryOwner.id) {
      throw new BankingError(400, 'CO_OWNER_MUST_BE_DIFFERENT', 'The co-owner must be a different customer.');
    }
    if (!coOwner.isActive) {
      throw new BankingError(409, 'CO_OWNER_INACTIVE', 'Inactive customers cannot be added as joint account owners.');
    }

    return createWithUniqueNumber({
      customerId,
      coOwnerCustomerId: coOwner.id,
      ownershipType: 'JOINT',
      type: valid.type,
      displayName: valid.displayName,
      balanceCents: openingBalanceCents,
      currency: 'AUD',
    });
  };

  const listAccounts = async (customerId) => {
    await assertActiveCustomer(customerId);
    const accounts = await prisma.account.findMany({
      where: { OR: [{ customerId }, { coOwnerCustomerId: customerId }] },
      select: ACCOUNT_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return accounts.map(mapAccount);
  };

  return { createAccount, createJointAccount, listAccounts };
}

const defaultService = createAccountService();

module.exports = {
  ACCOUNT_TYPES,
  OWNERSHIP_TYPES,
  ACCOUNT_OWNER_SELECT,
  ACCOUNT_SELECT,
  mapAccount,
  generateAccountNumber,
  validateAccountInput,
  validateJointAccountInput,
  createAccountService,
  createAccount: defaultService.createAccount,
  createJointAccount: defaultService.createJointAccount,
  listAccounts: defaultService.listAccounts,
};
