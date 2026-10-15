const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
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
    address: process.env.SEED_CUSTOMER_ADDRESS?.trim() || null,
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
      address: payload.address,
      phoneNumber: payload.phoneNumber,
      dateOfBirth: payload.dateOfBirth,
      isActive: payload.isActive,
      passwordHash: payload.passwordHash,
    },
  });

  const recipient = await prisma.customer.upsert({
    where: { email: 'payments-recipient@express-bank.invalid' },
    create: {
      id: 'seed-payment-recipient',
      email: 'payments-recipient@express-bank.invalid',
      passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12),
      firstName: 'Harbour',
      lastName: 'Services',
      isActive: true,
    },
    update: { firstName: 'Harbour', lastName: 'Services', isActive: true },
  });
  const recipientAccount = await prisma.account.upsert({
    where: { accountNumber: 'EXB-PAYMENTS-001' },
    create: {
      id: 'seed-payment-recipient-account',
      accountNumber: 'EXB-PAYMENTS-001',
      customerId: recipient.id,
      ownershipType: 'SINGLE',
      type: 'BUSINESS',
      displayName: 'Harbour Services',
      balanceCents: 250000,
      currency: 'AUD',
    },
    update: { customerId: recipient.id, displayName: 'Harbour Services' },
  });
  await prisma.payIdDirectoryEntry.upsert({
    where: { value: 'harbour.services@example.test' },
    create: {
      id: 'seed-payid-harbour-services',
      type: 'EMAIL',
      value: 'harbour.services@example.test',
      displayName: 'Harbour Services',
      accountId: recipientAccount.id,
      isActive: true,
    },
    update: { displayName: 'Harbour Services', accountId: recipientAccount.id, isActive: true },
  });
  for (const biller of [
    { id: 'seed-bpay-biller-energy', billerCode: '123456', name: 'Example Energy', referenceLength: 10 },
    { id: 'seed-bpay-biller-council', billerCode: '98765', name: 'Example Council', referenceLength: 8 },
  ]) {
    await prisma.bpayBiller.upsert({
      where: { billerCode: biller.billerCode },
      create: { ...biller, isActive: true },
      update: { name: biller.name, referenceLength: biller.referenceLength, isActive: true },
    });
  }

  console.log(`Seeded customer ${customer.email}`);
  console.log('Seeded fictional Payments directory and BPAY billers.');
};

main()
  .catch((error) => {
    console.error('Failed to seed customer:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
