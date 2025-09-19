const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

dotenv.config();

const prisma = new PrismaClient();

const REQUIRED_ENV_VARS = [
  'SEED_CUSTOMER_EMAIL',
  'SEED_CUSTOMER_PASSWORD',
  'SEED_CUSTOMER_FIRST_NAME',
  'SEED_CUSTOMER_LAST_NAME',
];

const ensureSeedEnvironment = () => {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required seed environment variables: ${missing.join(', ')}`);
  }
};

const parseOptionalDate = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error('SEED_CUSTOMER_DATE_OF_BIRTH must be a valid ISO-8601 date string');
  }

  return parsed;
};

const buildSeedPayload = async () => {
  ensureSeedEnvironment();

  const email = process.env.SEED_CUSTOMER_EMAIL.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(process.env.SEED_CUSTOMER_PASSWORD, 12);

  return {
    email,
    passwordHash,
    firstName: process.env.SEED_CUSTOMER_FIRST_NAME.trim(),
    lastName: process.env.SEED_CUSTOMER_LAST_NAME.trim(),
    phoneNumber: process.env.SEED_CUSTOMER_PHONE ?? null,
    dateOfBirth: parseOptionalDate(process.env.SEED_CUSTOMER_DATE_OF_BIRTH ?? null),
    isActive: process.env.SEED_CUSTOMER_IS_ACTIVE
      ? process.env.SEED_CUSTOMER_IS_ACTIVE.toLowerCase() !== 'false'
      : true,
  };
};

const main = async () => {
  const payload = await buildSeedPayload();

  const customer = await prisma.customer.upsert({
    where: { email: payload.email },
    create: payload,
    update: {
      firstName: payload.firstName,
      lastName: payload.lastName,
      phoneNumber: payload.phoneNumber,
      dateOfBirth: payload.dateOfBirth,
      isActive: payload.isActive,
      passwordHash: payload.passwordHash,
    },
  });

  console.log(`Seeded customer ${customer.email}`);
};

main()
  .catch((error) => {
    console.error('Failed to seed customer:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
