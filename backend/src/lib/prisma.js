const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config();

let prisma;

const getClient = () => {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
};

module.exports = {
  getPrismaClient: getClient,
};
