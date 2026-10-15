const bcrypt = require('bcrypt');
const { getPrismaClient } = require('../lib/prisma');
const { BankingError } = require('../errors/BankingError');

const CUSTOMER_PROFILE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  address: true,
  phoneNumber: true,
  dateOfBirth: true,
  lastLoginAt: true,
};

const normalizeEmail = (email) => typeof email === 'string' ? email.trim().toLowerCase() : '';

function validateRegistration({ email, password, firstName, lastName } = {}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedFirstName = typeof firstName === 'string' ? firstName.trim() : '';
  const normalizedLastName = typeof lastName === 'string' ? lastName.trim() : '';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new BankingError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw new BankingError(400, 'INVALID_PASSWORD', 'Password must be at least 8 characters.');
  }
  if (!normalizedFirstName || normalizedFirstName.length > 100) {
    throw new BankingError(400, 'INVALID_FIRST_NAME', 'First name is required and must be 100 characters or fewer.');
  }
  if (!normalizedLastName || normalizedLastName.length > 100) {
    throw new BankingError(400, 'INVALID_LAST_NAME', 'Last name is required and must be 100 characters or fewer.');
  }

  return {
    email: normalizedEmail,
    password,
    firstName: normalizedFirstName,
    lastName: normalizedLastName,
  };
}

function validateProfileUpdate({ firstName, lastName, address } = {}) {
  const normalizedFirstName = typeof firstName === 'string' ? firstName.trim() : '';
  const normalizedLastName = typeof lastName === 'string' ? lastName.trim() : '';
  const normalizedAddress = typeof address === 'string' ? address.trim() : '';
  if (!normalizedFirstName || normalizedFirstName.length > 100) {
    throw new BankingError(400, 'INVALID_FIRST_NAME', 'First name is required and must be 100 characters or fewer.');
  }
  if (!normalizedLastName || normalizedLastName.length > 100) {
    throw new BankingError(400, 'INVALID_LAST_NAME', 'Last name is required and must be 100 characters or fewer.');
  }
  if (!normalizedAddress || normalizedAddress.length > 250) {
    throw new BankingError(400, 'INVALID_ADDRESS', 'Address is required and must be 250 characters or fewer.');
  }
  return { firstName: normalizedFirstName, lastName: normalizedLastName, address: normalizedAddress };
}

function createCustomerService({ prisma = getPrismaClient(), passwordHasher = bcrypt } = {}) {
  const authenticateCustomer = async (email, password) => {
    const normalizedEmail = normalizeEmail(email);
    const customer = await prisma.customer.findUnique({
      where: { email: normalizedEmail },
      select: {
        ...CUSTOMER_PROFILE_SELECT,
        passwordHash: true,
        isActive: true,
      },
    });

    if (!customer || !customer.isActive) {
      return null;
    }

    const passwordValid = await passwordHasher.compare(password, customer.passwordHash);

    if (!passwordValid) {
      return null;
    }

    return prisma.customer.update({
      where: { id: customer.id },
      data: { lastLoginAt: new Date() },
      select: CUSTOMER_PROFILE_SELECT,
    });
  };

  const createCustomer = async (registration) => {
    const valid = validateRegistration(registration);
    const passwordHash = await passwordHasher.hash(valid.password, 12);

    try {
      return await prisma.customer.create({
        data: {
          email: valid.email,
          passwordHash,
          firstName: valid.firstName,
          lastName: valid.lastName,
        },
        select: CUSTOMER_PROFILE_SELECT,
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new BankingError(409, 'EMAIL_ALREADY_EXISTS', 'A customer with this email already exists.');
      }
      throw error;
    }
  };

  const updateProfile = async (customerId, input) => {
    const valid = validateProfileUpdate(input);
    return prisma.customer.update({
      where: { id: customerId },
      data: valid,
      select: CUSTOMER_PROFILE_SELECT,
    });
  };

  return { authenticateCustomer, createCustomer, updateProfile };
}

const defaultService = createCustomerService();

module.exports = {
  CUSTOMER_PROFILE_SELECT,
  normalizeEmail,
  validateRegistration,
  validateProfileUpdate,
  createCustomerService,
  authenticateCustomer: defaultService.authenticateCustomer,
  createCustomer: defaultService.createCustomer,
  updateProfile: defaultService.updateProfile,
};
