-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OPERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeCode" TEXT NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RegisterGroupRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "minRegId" INTEGER NOT NULL,
    "maxRegId" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostname" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "registerId" INTEGER NOT NULL,
    "registerIdPadded" TEXT NOT NULL,
    "registerGroupName" TEXT NOT NULL,
    "fqdnOrIp" TEXT,
    "reachabilityStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "winrmStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "readyForDeploy" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" DATETIME,
    "lastDeploymentStatus" TEXT,
    "lastDeploymentAt" DATETIME,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Machine_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeploymentJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "releaseNumber" TEXT NOT NULL,
    "installerZipPath" TEXT NOT NULL,
    "antPropertiesPath" TEXT NOT NULL,
    "remoteCopyPath" TEXT NOT NULL,
    "remoteUnzipPath" TEXT NOT NULL,
    "currentInstallPath" TEXT NOT NULL DEFAULT 'C:\OracleRetailStore\CLIENT',
    "backupNamingRule" TEXT NOT NULL,
    "executionMode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "throttleLimit" INTEGER NOT NULL DEFAULT 10,
    "autoRollback" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "scheduledFor" DATETIME,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "summaryJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeploymentJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeploymentJobTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "backupPath" TEXT,
    "remoteZipPath" TEXT,
    "remoteExtractPath" TEXT,
    "installExitCode" INTEGER,
    "logVerdict" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "matchedLogPath" TEXT,
    "rollbackResult" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "leasedBy" TEXT,
    "leaseExpiresAt" DATETIME,
    "queuedAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeploymentJobTarget_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DeploymentJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeploymentJobTarget_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeploymentStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "stepKey" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "detailJson" JSONB,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeploymentStep_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "DeploymentJobTarget" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeploymentLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT,
    "targetId" TEXT,
    "attemptNumber" INTEGER,
    "source" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rawChunk" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeploymentLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DeploymentJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeploymentLog_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "DeploymentJobTarget" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "fireAt" DATETIME NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "firedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Schedule_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DeploymentJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "detailJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Store_storeCode_key" ON "Store"("storeCode");

-- CreateIndex
CREATE INDEX "RegisterGroupRule_minRegId_maxRegId_idx" ON "RegisterGroupRule"("minRegId", "maxRegId");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_hostname_key" ON "Machine"("hostname");

-- CreateIndex
CREATE INDEX "Machine_storeId_idx" ON "Machine"("storeId");

-- CreateIndex
CREATE INDEX "Machine_registerGroupName_idx" ON "Machine"("registerGroupName");

-- CreateIndex
CREATE INDEX "Machine_registerId_idx" ON "Machine"("registerId");

-- CreateIndex
CREATE INDEX "Machine_reachabilityStatus_idx" ON "Machine"("reachabilityStatus");

-- CreateIndex
CREATE INDEX "Machine_lastDeploymentStatus_idx" ON "Machine"("lastDeploymentStatus");

-- CreateIndex
CREATE INDEX "DeploymentJob_status_idx" ON "DeploymentJob"("status");

-- CreateIndex
CREATE INDEX "DeploymentJob_releaseNumber_idx" ON "DeploymentJob"("releaseNumber");

-- CreateIndex
CREATE INDEX "DeploymentJob_createdAt_idx" ON "DeploymentJob"("createdAt");

-- CreateIndex
CREATE INDEX "DeploymentJobTarget_jobId_status_idx" ON "DeploymentJobTarget"("jobId", "status");

-- CreateIndex
CREATE INDEX "DeploymentJobTarget_machineId_idx" ON "DeploymentJobTarget"("machineId");

-- CreateIndex
CREATE INDEX "DeploymentJobTarget_status_idx" ON "DeploymentJobTarget"("status");

-- CreateIndex
CREATE INDEX "DeploymentJobTarget_status_leaseExpiresAt_idx" ON "DeploymentJobTarget"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentJobTarget_jobId_machineId_attemptNumber_key" ON "DeploymentJobTarget"("jobId", "machineId", "attemptNumber");

-- CreateIndex
CREATE INDEX "DeploymentStep_targetId_sequence_idx" ON "DeploymentStep"("targetId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentStep_targetId_attemptNumber_stepKey_key" ON "DeploymentStep"("targetId", "attemptNumber", "stepKey");

-- CreateIndex
CREATE INDEX "DeploymentLog_jobId_createdAt_idx" ON "DeploymentLog"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "DeploymentLog_targetId_createdAt_idx" ON "DeploymentLog"("targetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_jobId_key" ON "Schedule"("jobId");

-- CreateIndex
CREATE INDEX "Schedule_status_fireAt_idx" ON "Schedule"("status", "fireAt");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");
