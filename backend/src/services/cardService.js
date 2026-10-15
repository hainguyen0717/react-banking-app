const { randomInt } = require('node:crypto');
const { getPrismaClient } = require('../lib/prisma');
const { BankingError } = require('../errors/BankingError');

const SAMPLE_TRANSACTIONS = Object.freeze([
  { merchant: 'Corner Cafe', amountCents: 875, daysAgo: 1 },
  { merchant: 'City Grocer', amountCents: 4260, daysAgo: 2 },
  { merchant: 'Metro Transit', amountCents: 520, daysAgo: 3 },
  { merchant: 'Book & Paper', amountCents: 2199, daysAgo: 4 },
  { merchant: 'Harbour Pharmacy', amountCents: 1635, daysAgo: 5 },
]);

const CARD_SELECT = {
  id: true,
  accountId: true,
  lastFour: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  account: { select: { accountNumber: true, displayName: true, type: true } },
  transactions: {
    select: { id: true, sampleSequence: true, merchant: true, amountCents: true, occurredAt: true },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
  },
};

function mapCard(card) {
  const { lastFour, account, ...safe } = card;
  return { ...safe, maskedNumber: `•••• ${lastFour}`, account };
}

function generateLastFour() {
  return randomInt(0, 10000).toString().padStart(4, '0');
}

function createCardService({ prisma = getPrismaClient(), now = () => new Date(), lastFourGenerator = generateLastFour } = {}) {
  const assertOwnedAccount = async (client, customerId, accountId) => {
    if (typeof accountId !== 'string' || !accountId.trim()) {
      throw new BankingError(400, 'INVALID_ACCOUNT', 'Account ID is required.');
    }
    const account = await client.account.findUnique({
      where: { id: accountId.trim() },
      select: { id: true, customerId: true, coOwnerCustomerId: true },
    });
    if (!account) throw new BankingError(404, 'ACCOUNT_NOT_FOUND', 'Account was not found.');
    if (account.customerId !== customerId && account.coOwnerCustomerId !== customerId) {
      throw new BankingError(403, 'ACCOUNT_FORBIDDEN', 'This account does not belong to the customer.');
    }
    return account;
  };

  const createCard = async (customerId, { accountId } = {}) => prisma.$transaction(async (tx) => {
    const account = await assertOwnedAccount(tx, customerId, accountId);
    const createdAt = now();
    const card = await tx.card.create({
      data: {
        customerId,
        accountId: account.id,
        lastFour: lastFourGenerator(),
        transactions: {
          create: SAMPLE_TRANSACTIONS.map((sample, index) => ({
            sampleSequence: index + 1,
            merchant: sample.merchant,
            amountCents: sample.amountCents,
            occurredAt: new Date(createdAt.valueOf() - sample.daysAgo * 86_400_000),
          })),
        },
      },
      select: CARD_SELECT,
    });
    return mapCard(card);
  });

  const listCards = async (customerId) => {
    const cards = await prisma.card.findMany({
      where: { customerId },
      select: CARD_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return cards.map(mapCard);
  };

  const getOwnedCard = async (customerId, cardId) => {
    const card = await prisma.card.findUnique({ where: { id: cardId }, select: { ...CARD_SELECT, customerId: true } });
    if (!card) throw new BankingError(404, 'CARD_NOT_FOUND', 'Card was not found.');
    if (card.customerId !== customerId) throw new BankingError(403, 'CARD_FORBIDDEN', 'This card does not belong to the customer.');
    const { customerId: _customerId, ...safeCard } = card;
    return mapCard(safeCard);
  };

  const transitionCard = async (customerId, cardId, fromStatus, status) => {
    const existing = await prisma.card.findUnique({ where: { id: cardId }, select: { customerId: true, status: true } });
    if (!existing) throw new BankingError(404, 'CARD_NOT_FOUND', 'Card was not found.');
    if (existing.customerId !== customerId) throw new BankingError(403, 'CARD_FORBIDDEN', 'This card does not belong to the customer.');
    if (existing.status !== fromStatus) {
      throw new BankingError(409, 'INVALID_CARD_STATE', `A ${existing.status.toLowerCase()} card cannot be changed to ${status.toLowerCase()}.`);
    }
    const changed = await prisma.card.updateMany({ where: { id: cardId, customerId, status: fromStatus }, data: { status } });
    if (changed.count !== 1) throw new BankingError(409, 'INVALID_CARD_STATE', 'The card state changed before this action completed.');
    return getOwnedCard(customerId, cardId);
  };

  return {
    createCard,
    listCards,
    getCard: getOwnedCard,
    lockCard: (customerId, cardId) => transitionCard(customerId, cardId, 'ACTIVE', 'LOCKED'),
    unlockCard: (customerId, cardId) => transitionCard(customerId, cardId, 'LOCKED', 'ACTIVE'),
    disableCard: async (customerId, cardId) => {
      const existing = await prisma.card.findUnique({ where: { id: cardId }, select: { customerId: true, status: true } });
      if (!existing) throw new BankingError(404, 'CARD_NOT_FOUND', 'Card was not found.');
      if (existing.customerId !== customerId) throw new BankingError(403, 'CARD_FORBIDDEN', 'This card does not belong to the customer.');
      if (existing.status === 'DISABLED') throw new BankingError(409, 'INVALID_CARD_STATE', 'This card is already disabled.');
      const changed = await prisma.card.updateMany({ where: { id: cardId, customerId, status: existing.status }, data: { status: 'DISABLED' } });
      if (changed.count !== 1) throw new BankingError(409, 'INVALID_CARD_STATE', 'The card state changed before this action completed.');
      return getOwnedCard(customerId, cardId);
    },
  };
}

module.exports = { SAMPLE_TRANSACTIONS, CARD_SELECT, mapCard, generateLastFour, createCardService };
