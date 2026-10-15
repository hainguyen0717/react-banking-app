ALTER TABLE "Customer" ADD COLUMN "address" TEXT;

CREATE TABLE "ScheduledTransfer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "sourceAccountId" TEXT NOT NULL,
  "destinationAccountId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL CHECK ("amountCents" > 0),
  "description" TEXT,
  "scheduledFor" DATETIME NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  "failureReason" TEXT,
  "processedAt" DATETIME,
  "transferId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ScheduledTransfer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScheduledTransfer_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ScheduledTransfer_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ScheduledTransfer_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CHECK ("sourceAccountId" <> "destinationAccountId")
);
CREATE UNIQUE INDEX "ScheduledTransfer_transferId_key" ON "ScheduledTransfer"("transferId");
CREATE INDEX "ScheduledTransfer_customerId_scheduledFor_idx" ON "ScheduledTransfer"("customerId", "scheduledFor");
CREATE INDEX "ScheduledTransfer_status_scheduledFor_idx" ON "ScheduledTransfer"("status", "scheduledFor");

CREATE TABLE "Card" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "lastFour" TEXT NOT NULL CHECK (length("lastFour") = 4 AND "lastFour" NOT GLOB '*[^0-9]*'),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'LOCKED', 'DISABLED')),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Card_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Card_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Card_customerId_createdAt_idx" ON "Card"("customerId", "createdAt");
CREATE INDEX "Card_accountId_idx" ON "Card"("accountId");

CREATE TABLE "CardTransaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "cardId" TEXT NOT NULL,
  "sampleSequence" INTEGER NOT NULL CHECK ("sampleSequence" BETWEEN 1 AND 5),
  "merchant" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL CHECK ("amountCents" > 0),
  "occurredAt" DATETIME NOT NULL,
  CONSTRAINT "CardTransaction_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CardTransaction_cardId_sampleSequence_key" ON "CardTransaction"("cardId", "sampleSequence");
CREATE INDEX "CardTransaction_cardId_occurredAt_idx" ON "CardTransaction"("cardId", "occurredAt");
