const bcrypt = require('bcrypt');
const { getPrismaClient } = require('../lib/prisma');

const prisma = getPrismaClient();

const authenticateCustomer = async (email, password) => {
  const customer = await prisma.customer.findUnique({
    where: { email },
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
  });

  const { passwordHash, ...safeCustomer } = updatedCustomer;
  return safeCustomer;
};

module.exports = {
  authenticateCustomer,
};
