-- Redefine Account so existing IDs and transfer references remain stable while
-- all existing accounts become SINGLE ownership records.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "coOwnerCustomerId" TEXT,
    "ownershipType" TEXT NOT NULL DEFAULT 'SINGLE' CHECK ("ownershipType" IN ('SINGLE', 'JOINT')),
    "type" TEXT NOT NULL CHECK ("type" IN ('EVERYDAY', 'SAVINGS', 'BUSINESS')),
    "displayName" TEXT,
    "balanceCents" INTEGER NOT NULL CHECK ("balanceCents" >= 0),
    "currency" TEXT NOT NULL DEFAULT 'AUD' CHECK ("currency" = 'AUD'),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Account_primaryOwner_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Account_coOwner_fkey" FOREIGN KEY ("coOwnerCustomerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Account_ownership_shape_check" CHECK (
        ("ownershipType" = 'SINGLE' AND "coOwnerCustomerId" IS NULL)
        OR
        ("ownershipType" = 'JOINT' AND "coOwnerCustomerId" IS NOT NULL AND "coOwnerCustomerId" <> "customerId")
    )
);

INSERT INTO "new_Account" (
    "id", "accountNumber", "customerId", "coOwnerCustomerId", "ownershipType",
    "type", "displayName", "balanceCents", "currency", "createdAt", "updatedAt"
)
SELECT
    "id", "accountNumber", "customerId", NULL, 'SINGLE',
    "type", "displayName", "balanceCents", "currency", "createdAt", "updatedAt"
FROM "Account";

DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";

CREATE UNIQUE INDEX "Account_accountNumber_key" ON "Account"("accountNumber");
CREATE INDEX "Account_customerId_idx" ON "Account"("customerId");
CREATE INDEX "Account_coOwnerCustomerId_idx" ON "Account"("coOwnerCustomerId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
