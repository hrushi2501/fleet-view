-- Alter HireLog
ALTER TABLE "HireLog" ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "HireLog" ADD COLUMN "approvedBy" TEXT;
ALTER TABLE "HireLog" ADD COLUMN "approvedAt" TIMESTAMP(3);

-- Alter HireInvoice
ALTER TABLE "HireInvoice" ADD COLUMN "approvedBy" TEXT;
ALTER TABLE "HireInvoice" ADD COLUMN "approvedAt" TIMESTAMP(3);

-- Create HireInspection
CREATE TABLE "HireInspection" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inspector" TEXT,
    "meterValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fuelLevelPct" DOUBLE PRECISION,
    "condition" TEXT NOT NULL DEFAULT 'GOOD',
    "damages" TEXT,
    "photos" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HireInspection_pkey" PRIMARY KEY ("id")
);

-- Create HireContractAmendment
CREATE TABLE "HireContractAmendment" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "previousRate" DOUBLE PRECISION NOT NULL,
    "newRate" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HireContractAmendment_pkey" PRIMARY KEY ("id")
);

-- Create HirePayment
CREATE TABLE "HirePayment" (
    "id" TEXT NOT NULL,
    "contractId" TEXT,
    "vendor" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL,
    "invoiceId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referenceNo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HirePayment_pkey" PRIMARY KEY ("id")
);

-- Add Foreign Keys
ALTER TABLE "HireInspection" ADD CONSTRAINT "HireInspection_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "HireContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HireContractAmendment" ADD CONSTRAINT "HireContractAmendment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "HireContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HirePayment" ADD CONSTRAINT "HirePayment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "HireContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create Indexes
CREATE INDEX "HireInspection_contractId_type_idx" ON "HireInspection"("contractId", "type");
CREATE INDEX "HireContractAmendment_contractId_idx" ON "HireContractAmendment"("contractId");
CREATE INDEX "HirePayment_vendor_idx" ON "HirePayment"("vendor");
CREATE INDEX "HirePayment_contractId_idx" ON "HirePayment"("contractId");
