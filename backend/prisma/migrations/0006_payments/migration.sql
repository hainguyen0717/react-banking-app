CREATE TABLE "PayIdDirectoryEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "type" TEXT NOT NULL DEFAULT 'EMAIL' CHECK ("type" = 'EMAIL'),
  "value" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PayIdDirectoryEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PayIdDirectoryEntry_value_key" ON "PayIdDirectoryEntry"("value");
CREATE INDEX "PayIdDirectoryEntry_accountId_idx" ON "PayIdDirectoryEntry"("accountId");

CREATE TABLE "BpayBiller" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "billerCode" TEXT NOT NULL CHECK (length("billerCode") > 0 AND "billerCode" NOT GLOB '*[^0-9]*'),
  "name" TEXT NOT NULL,
  "referenceLength" INTEGER NOT NULL CHECK ("referenceLength" > 0),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "BpayBiller_billerCode_key" ON "BpayBiller"("billerCode");

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "sourceAccountId" TEXT NOT NULL,
  "method" TEXT NOT NULL CHECK ("method" IN ('BANK_ACCOUNT', 'PAYID', 'BPAY')),
  "amountCents" INTEGER NOT NULL CHECK ("amountCents" > 0),
  "description" TEXT CHECK ("description" IS NULL OR length("description") <= 140),
  "transferId" TEXT,
  "payIdDirectoryEntryId" TEXT,
  "bpayBillerId" TEXT,
  "customerReference" TEXT,
  "sourceAccountNumberSnapshot" TEXT NOT NULL,
  "payeeNameSnapshot" TEXT NOT NULL,
  "destinationAccountNumberSnapshot" TEXT,
  "payIdSnapshot" TEXT,
  "billerCodeSnapshot" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Payment_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Payment_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Payment_payIdDirectoryEntryId_fkey" FOREIGN KEY ("payIdDirectoryEntryId") REFERENCES "PayIdDirectoryEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Payment_bpayBillerId_fkey" FOREIGN KEY ("bpayBillerId") REFERENCES "BpayBiller" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK (
    ("method" = 'BANK_ACCOUNT' AND "transferId" IS NOT NULL AND "payIdDirectoryEntryId" IS NULL AND "bpayBillerId" IS NULL AND "customerReference" IS NULL AND "destinationAccountNumberSnapshot" IS NOT NULL AND "payIdSnapshot" IS NULL AND "billerCodeSnapshot" IS NULL)
    OR
    ("method" = 'PAYID' AND "transferId" IS NOT NULL AND "payIdDirectoryEntryId" IS NOT NULL AND "bpayBillerId" IS NULL AND "customerReference" IS NULL AND "destinationAccountNumberSnapshot" IS NULL AND "payIdSnapshot" IS NOT NULL AND "billerCodeSnapshot" IS NULL)
    OR
    ("method" = 'BPAY' AND "transferId" IS NULL AND "payIdDirectoryEntryId" IS NULL AND "bpayBillerId" IS NOT NULL AND "customerReference" IS NOT NULL AND "destinationAccountNumberSnapshot" IS NULL AND "payIdSnapshot" IS NULL AND "billerCodeSnapshot" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "Payment_transferId_key" ON "Payment"("transferId");
CREATE INDEX "Payment_customerId_createdAt_idx" ON "Payment"("customerId", "createdAt");
CREATE INDEX "Payment_sourceAccountId_createdAt_idx" ON "Payment"("sourceAccountId", "createdAt");
CREATE INDEX "Payment_payIdDirectoryEntryId_idx" ON "Payment"("payIdDirectoryEntryId");
CREATE INDEX "Payment_bpayBillerId_idx" ON "Payment"("bpayBillerId");
