const bcrypt = require('bcrypt');
const { getPrismaClient } = require('../lib/prisma');

const prisma = getPrismaClient();

const CUSTOMER_PROFILE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phoneNumber: true,
  dateOfBirth: true,
  lastLoginAt: true,
};

const authenticateCustomer = async (email, password) => {
  const customer = await prisma.customer.findUnique({
    where: { email },
    select: {
      ...CUSTOMER_PROFILE_SELECT,
      passwordHash: true,
      isActive: true,
    },
  });

  if (!customer || !customer.isActive) {
    return null;
  }

  const passwordValid = await bcrypt.compare(password, customer.passwordHash);

  if (!passwordValid) {
    return null;
  }

  const updatedCustomer = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      lastLoginAt: new Date(),
    },
    select: CUSTOMER_PROFILE_SELECT,
  });

  return updatedCustomer;
};

module.exports = {
  authenticateCustomer,
};
