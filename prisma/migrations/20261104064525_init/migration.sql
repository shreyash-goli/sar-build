-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL,
    "observedAt" DATETIME,
    "excerpt" TEXT,
    "path" TEXT,
    "contentHash" TEXT,
    "classification" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "FundingSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "externalFundId" TEXT,
    "name" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "limitCents" BIGINT,
    "availableCents" BIGINT,
    "observedAt" DATETIME NOT NULL,
    "evidenceId" TEXT NOT NULL,
    CONSTRAINT "FundingSource_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentInstrument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "externalCardId" TEXT,
    "fundingSourceId" TEXT,
    "status" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    CONSTRAINT "PaymentInstrument_fundingSourceId_fkey" FOREIGN KEY ("fundingSourceId") REFERENCES "FundingSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PaymentInstrument_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "billingMethod" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    CONSTRAINT "Vendor_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VendorCharge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "fundingSourceId" TEXT,
    "expectedAt" DATETIME NOT NULL,
    "expectedCents" BIGINT,
    "status" TEXT NOT NULL,
    "sourceClass" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    CONSTRAINT "VendorCharge_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VendorCharge_fundingSourceId_fkey" FOREIGN KEY ("fundingSourceId") REFERENCES "FundingSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VendorCharge_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerEventId" TEXT,
    "vendorId" TEXT NOT NULL,
    "fundingSourceId" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "state" TEXT NOT NULL,
    "reason" TEXT,
    "evidenceId" TEXT NOT NULL,
    CONSTRAINT "Transaction_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_fundingSourceId_fkey" FOREIGN KEY ("fundingSourceId") REFERENCES "FundingSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "criticality" TEXT NOT NULL,
    "owner" TEXT,
    "evidenceId" TEXT NOT NULL,
    CONSTRAINT "Node_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Edge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "dependencyStrength" TEXT NOT NULL,
    "confidenceTier" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    CONSTRAINT "Edge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "Node" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Edge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "Node" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Edge_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scenarioKey" TEXT,
    "status" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "firstSeenAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "primaryVendorId" TEXT,
    "detectionRule" TEXT NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    CONSTRAINT "Incident_primaryVendorId_fkey" FOREIGN KEY ("primaryVendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Incident_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Simulation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "patchJson" TEXT NOT NULL,
    "beforeJson" TEXT NOT NULL,
    "afterJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "createdBy" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL,
    CONSTRAINT "Simulation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActionProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "approver" TEXT,
    "simulated" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "ActionProposal_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL,
    "at" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "EvidenceRecord_classification_idx" ON "EvidenceRecord"("classification");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceRecord_sourceSystem_sourceId_capturedAt_key" ON "EvidenceRecord"("sourceSystem", "sourceId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FundingSource_externalFundId_key" ON "FundingSource"("externalFundId");

-- CreateIndex
CREATE INDEX "FundingSource_evidenceId_idx" ON "FundingSource"("evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentInstrument_externalCardId_key" ON "PaymentInstrument"("externalCardId");

-- CreateIndex
CREATE INDEX "PaymentInstrument_fundingSourceId_idx" ON "PaymentInstrument"("fundingSourceId");

-- CreateIndex
CREATE INDEX "PaymentInstrument_evidenceId_idx" ON "PaymentInstrument"("evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_normalizedKey_key" ON "Vendor"("normalizedKey");

-- CreateIndex
CREATE INDEX "Vendor_evidenceId_idx" ON "Vendor"("evidenceId");

-- CreateIndex
CREATE INDEX "VendorCharge_vendorId_expectedAt_idx" ON "VendorCharge"("vendorId", "expectedAt");

-- CreateIndex
CREATE INDEX "VendorCharge_fundingSourceId_idx" ON "VendorCharge"("fundingSourceId");

-- CreateIndex
CREATE INDEX "VendorCharge_evidenceId_idx" ON "VendorCharge"("evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_providerEventId_key" ON "Transaction"("providerEventId");

-- CreateIndex
CREATE INDEX "Transaction_vendorId_occurredAt_idx" ON "Transaction"("vendorId", "occurredAt");

-- CreateIndex
CREATE INDEX "Transaction_fundingSourceId_idx" ON "Transaction"("fundingSourceId");

-- CreateIndex
CREATE INDEX "Transaction_evidenceId_idx" ON "Transaction"("evidenceId");

-- CreateIndex
CREATE INDEX "Node_kind_idx" ON "Node"("kind");

-- CreateIndex
CREATE INDEX "Node_evidenceId_idx" ON "Node"("evidenceId");

-- CreateIndex
CREATE INDEX "Edge_toNodeId_idx" ON "Edge"("toNodeId");

-- CreateIndex
CREATE INDEX "Edge_reviewStatus_idx" ON "Edge"("reviewStatus");

-- CreateIndex
CREATE INDEX "Edge_evidenceId_idx" ON "Edge"("evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "Edge_fromNodeId_toNodeId_relation_key" ON "Edge"("fromNodeId", "toNodeId", "relation");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_scenarioKey_key" ON "Incident"("scenarioKey");

-- CreateIndex
CREATE INDEX "Incident_status_severity_idx" ON "Incident"("status", "severity");

-- CreateIndex
CREATE INDEX "Incident_primaryVendorId_idx" ON "Incident"("primaryVendorId");

-- CreateIndex
CREATE INDEX "Incident_evidenceId_idx" ON "Incident"("evidenceId");

-- CreateIndex
CREATE INDEX "Simulation_incidentId_createdAt_idx" ON "Simulation"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "ActionProposal_incidentId_createdAt_idx" ON "ActionProposal"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "ActionProposal_state_idx" ON "ActionProposal"("state");

-- CreateIndex
CREATE INDEX "AuditEvent_subjectId_at_idx" ON "AuditEvent"("subjectId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_at_idx" ON "AuditEvent"("at");
