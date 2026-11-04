-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alertKey" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "incidentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "previousSeverity" TEXT,
    "category" TEXT,
    "previousCategory" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "owner" TEXT,
    "link" TEXT NOT NULL,
    "fromFingerprint" TEXT,
    "toFingerprint" TEXT,
    "createdAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" DATETIME,
    "snoozedUntil" DATETIME,
    "snoozedBy" TEXT,
    CONSTRAINT "Alert_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Alert_alertKey_key" ON "Alert"("alertKey");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_seq_key" ON "Alert"("seq");

-- CreateIndex
CREATE INDEX "Alert_incidentId_seq_idx" ON "Alert"("incidentId", "seq");

-- CreateIndex
CREATE INDEX "Alert_status_idx" ON "Alert"("status");
