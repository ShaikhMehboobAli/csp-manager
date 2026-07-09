-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('SUPER_ADMIN', 'BC_ADMIN', 'CSP_ADMIN');

-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "public"."AgentType" AS ENUM ('CSP', 'KO');

-- CreateEnum
CREATE TYPE "public"."AgentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "public"."PlanOwnerType" AS ENUM ('BC', 'CSP');

-- CreateEnum
CREATE TYPE "public"."BillingCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "public"."SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "public"."ActivationStatus" AS ENUM ('NOT_ACTIVATED', 'ACTIVE', 'INACTIVE', 'REVOKED', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "public"."ReceiptStatus" AS ENUM ('SUCCESS', 'FAILED', 'PENDING');

-- CreateEnum
CREATE TYPE "public"."ReceiptType" AS ENUM ('AEPS', 'BBPS', 'MICRO_ATM', 'ACCOUNT_OPENING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "public"."BusinessCorrespondentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "public"."SubscriptionOwnerType" AS ENUM ('BC', 'CSP');

-- CreateEnum
CREATE TYPE "public"."SubscriptionEventType" AS ENUM ('PURCHASE', 'UPGRADE', 'RENEWAL', 'CANCELLATION');

-- CreateEnum
CREATE TYPE "public"."SubscriptionType" AS ENUM ('TRIAL', 'PAID', 'PROMOTIONAL', 'LIFETIME');

-- CreateEnum
CREATE TYPE "public"."MachineStatus" AS ENUM ('PENDING', 'ACTIVE', 'OFFLINE', 'BLOCKED', 'RETIRED');

-- CreateEnum
CREATE TYPE "public"."FeatureCategory" AS ENUM ('DASHBOARD', 'RECEIPT', 'FLOAT', 'REPORT', 'MACHINE', 'SUBSCRIPTION', 'USER', 'NOTIFICATION', 'SETTINGS');

-- CreateEnum
CREATE TYPE "public"."SettingType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'JSON');

-- CreateEnum
CREATE TYPE "public"."TransactionCategory" AS ENUM ('CASH_DEPOSIT', 'CASH_WITHDRAWAL', 'BALANCE_ENQUIRY', 'MINI_STATEMENT', 'ACCOUNT_OPENING', 'BBPS', 'MICRO_ATM', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."FloatLedgerType" AS ENUM ('OPENING', 'RECEIPT', 'ADJUSTMENT', 'LIMIT_TOPUP', 'LIMIT_REDUCTION', 'CORRECTION', 'RENEWAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "public"."FloatAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."FloatAdjustmentReason" AS ENUM ('RENEWAL', 'MANUAL_CORRECTION', 'INITIAL_SETUP', 'DEVICE_REPLACEMENT', 'SYSTEM_RECOVERY', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'ACTIVATE', 'DEACTIVATE', 'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_UPGRADED', 'SUBSCRIPTION_CANCELLED', 'SUBSCRIPTION_RENEWED', 'FLOAT_ADJUSTMENT', 'LIMIT_TOPUP', 'LIMIT_REDUCTION', 'PLAN_CREATED', 'PLAN_UPDATED', 'MACHINE_REGISTERED', 'MACHINE_TRANSFERRED', 'SETTINGS_UPDATED', 'PAYMENT_CREATED', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED');

-- CreateEnum
CREATE TYPE "public"."AuditEntity" AS ENUM ('USER', 'BC', 'AGENT', 'PLAN', 'PLAN_PRICING', 'SUBSCRIPTION', 'MACHINE', 'ACTIVATION', 'RECEIPT', 'AGENT_FLOAT', 'PAYMENT', 'SYSTEM_SETTING');

-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PaymentMethod" AS ENUM ('RAZORPAY', 'CASH', 'BANK_TRANSFER', 'UPI', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."PaymentProvider" AS ENUM ('RAZORPAY', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."NotificationType" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "public"."SessionEndReason" AS ENUM ('NORMAL_SHUTDOWN', 'SYSTEM_CRASH', 'POWER_FAILURE', 'WATCHER_CRASH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "public"."CommunicationChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "public"."CommunicationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "public"."UserRole" NOT NULL,
    "status" "public"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "bcId" TEXT,
    "agentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BusinessCorrespondent" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "email" TEXT,
    "address" TEXT,
    "status" "public"."BusinessCorrespondentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BusinessCorrespondent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Agent" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."AgentType" NOT NULL,
    "mobile" TEXT,
    "email" TEXT,
    "address" TEXT,
    "status" "public"."AgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "bcId" TEXT NOT NULL,
    "parentAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerType" "public"."PlanOwnerType" NOT NULL,
    "level" INTEGER NOT NULL,
    "machineLimit" INTEGER,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlanPricing" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "billingCycle" "public"."BillingCycle" NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Subscription" (
    "id" TEXT NOT NULL,
    "subscriptionNumber" TEXT NOT NULL,
    "bcId" TEXT,
    "agentId" TEXT,
    "planId" TEXT NOT NULL,
    "machineLimit" INTEGER NOT NULL,
    "amountPaid" DECIMAL(10,2) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "public"."SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "subscriptionType" "public"."SubscriptionType" NOT NULL DEFAULT 'PAID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SubscriptionHistory" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventType" "public"."SubscriptionEventType" NOT NULL,
    "previousPlanId" TEXT,
    "newPlanId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Feature" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "public"."FeatureCategory",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Feature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlanFeature" (
    "planId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,

    CONSTRAINT "PlanFeature_pkey" PRIMARY KEY ("planId","featureId")
);

-- CreateTable
CREATE TABLE "public"."SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "dataType" "public"."SettingType" NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "group" TEXT,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Machine" (
    "id" TEXT NOT NULL,
    "machineCode" TEXT NOT NULL,
    "machineName" TEXT,
    "fingerprint" TEXT NOT NULL,
    "watcherVersion" TEXT NOT NULL,
    "osName" TEXT,
    "osVersion" TEXT,
    "deviceName" TEXT,
    "ipAddress" TEXT,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."MachineStatus" NOT NULL DEFAULT 'PENDING',
    "currentAgentId" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastStartupAt" TIMESTAMP(3),
    "lastTransactionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "apiKeyHash" TEXT,
    "apiKeyIssuedAt" TIMESTAMP(3),
    "apiKeyExpiresAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "agentId" TEXT,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Activation" (
    "id" TEXT NOT NULL,
    "activationCode" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "status" "public"."ActivationStatus" NOT NULL DEFAULT 'NOT_ACTIVATED',
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "lastValidatedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "remarks" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MachineSession" (
    "id" TEXT NOT NULL,
    "machineSessionId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "firstAgentId" TEXT,
    "lastAgentId" TEXT,
    "isUnexpectedStop" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedReason" "public"."SessionEndReason",

    CONSTRAINT "MachineSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Receipt" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "receiptType" "public"."ReceiptType" NOT NULL,
    "transactionCategory" "public"."TransactionCategory" NOT NULL,
    "transactionType" TEXT NOT NULL,
    "status" "public"."ReceiptStatus" NOT NULL,
    "transactionAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "charges" DECIMAL(12,2),
    "stan" TEXT,
    "rrn" TEXT,
    "terminalId" TEXT,
    "customerName" TEXT,
    "customerAccount" TEXT,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AgentFloat" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "openingFloat" DECIMAL(12,2) NOT NULL,
    "currentCashInHand" DECIMAL(12,2) NOT NULL,
    "currentCashInAccount" DECIMAL(12,2) NOT NULL,
    "currentTotalFloat" DECIMAL(12,2) NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lastAdjustmentAt" TIMESTAMP(3),
    "lastReceiptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentFloat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FloatLedger" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "receiptId" TEXT,
    "ledgerType" "public"."FloatLedgerType" NOT NULL,
    "cashInHandChange" DECIMAL(12,2) NOT NULL,
    "cashInAccountChange" DECIMAL(12,2) NOT NULL,
    "balanceCashInHand" DECIMAL(12,2) NOT NULL,
    "balanceCashInAccount" DECIMAL(12,2) NOT NULL,
    "remarks" TEXT,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FloatLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FloatAdjustmentRequest" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "requestedCashInHand" DECIMAL(12,2) NOT NULL,
    "requestedCashInAccount" DECIMAL(12,2) NOT NULL,
    "systemCashInHand" DECIMAL(12,2) NOT NULL,
    "systemCashInAccount" DECIMAL(12,2) NOT NULL,
    "reason" "public"."FloatAdjustmentReason" NOT NULL,
    "description" TEXT,
    "status" "public"."FloatAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FloatAdjustmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "machineId" TEXT,
    "machineSessionId" TEXT,
    "action" "public"."AuditAction" NOT NULL,
    "entityType" "public"."AuditEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "description" TEXT,
    "oldData" JSONB,
    "newData" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Payment" (
    "id" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "paymentMethod" "public"."PaymentMethod" NOT NULL,
    "paymentProvider" "public"."PaymentProvider" NOT NULL,
    "status" "public"."PaymentStatus" NOT NULL,
    "transactionReference" TEXT,
    "gatewayTransactionId" TEXT,
    "gatewayResponse" JSONB,
    "remarks" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "invoiceNumber" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "public"."NotificationType" NOT NULL DEFAULT 'INFO',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isSent" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Communication" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "channel" "public"."CommunicationChannel" NOT NULL,
    "status" "public"."CommunicationStatus" NOT NULL DEFAULT 'PENDING',
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "template" TEXT,
    "sentAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Communication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE INDEX "User_bcId_idx" ON "public"."User"("bcId");

-- CreateIndex
CREATE INDEX "User_agentId_idx" ON "public"."User"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessCorrespondent_code_key" ON "public"."BusinessCorrespondent"("code");

-- CreateIndex
CREATE INDEX "BusinessCorrespondent_status_idx" ON "public"."BusinessCorrespondent"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_agentId_key" ON "public"."Agent"("agentId");

-- CreateIndex
CREATE INDEX "Agent_bcId_idx" ON "public"."Agent"("bcId");

-- CreateIndex
CREATE INDEX "Agent_parentAgentId_idx" ON "public"."Agent"("parentAgentId");

-- CreateIndex
CREATE INDEX "Agent_type_idx" ON "public"."Agent"("type");

-- CreateIndex
CREATE INDEX "Agent_status_idx" ON "public"."Agent"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "public"."Plan"("code");

-- CreateIndex
CREATE INDEX "Plan_ownerType_idx" ON "public"."Plan"("ownerType");

-- CreateIndex
CREATE INDEX "Plan_level_idx" ON "public"."Plan"("level");

-- CreateIndex
CREATE INDEX "PlanPricing_planId_idx" ON "public"."PlanPricing"("planId");

-- CreateIndex
CREATE INDEX "PlanPricing_billingCycle_idx" ON "public"."PlanPricing"("billingCycle");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_subscriptionNumber_key" ON "public"."Subscription"("subscriptionNumber");

-- CreateIndex
CREATE INDEX "Subscription_bcId_idx" ON "public"."Subscription"("bcId");

-- CreateIndex
CREATE INDEX "Subscription_agentId_idx" ON "public"."Subscription"("agentId");

-- CreateIndex
CREATE INDEX "Subscription_planId_idx" ON "public"."Subscription"("planId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "public"."Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_startDate_idx" ON "public"."Subscription"("startDate");

-- CreateIndex
CREATE INDEX "Subscription_endDate_idx" ON "public"."Subscription"("endDate");

-- CreateIndex
CREATE INDEX "SubscriptionHistory_subscriptionId_idx" ON "public"."SubscriptionHistory"("subscriptionId");

-- CreateIndex
CREATE INDEX "SubscriptionHistory_eventType_idx" ON "public"."SubscriptionHistory"("eventType");

-- CreateIndex
CREATE INDEX "SubscriptionHistory_createdAt_idx" ON "public"."SubscriptionHistory"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Feature_code_key" ON "public"."Feature"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "public"."SystemSetting"("key");

-- CreateIndex
CREATE INDEX "SystemSetting_group_idx" ON "public"."SystemSetting"("group");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_machineCode_key" ON "public"."Machine"("machineCode");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_fingerprint_key" ON "public"."Machine"("fingerprint");

-- CreateIndex
CREATE INDEX "Machine_currentAgentId_idx" ON "public"."Machine"("currentAgentId");

-- CreateIndex
CREATE INDEX "Machine_status_idx" ON "public"."Machine"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Activation_activationCode_key" ON "public"."Activation"("activationCode");

-- CreateIndex
CREATE INDEX "Activation_machineId_idx" ON "public"."Activation"("machineId");

-- CreateIndex
CREATE INDEX "Activation_subscriptionId_idx" ON "public"."Activation"("subscriptionId");

-- CreateIndex
CREATE INDEX "Activation_status_idx" ON "public"."Activation"("status");

-- CreateIndex
CREATE INDEX "Activation_expiresAt_idx" ON "public"."Activation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MachineSession_machineSessionId_key" ON "public"."MachineSession"("machineSessionId");

-- CreateIndex
CREATE INDEX "MachineSession_machineId_idx" ON "public"."MachineSession"("machineId");

-- CreateIndex
CREATE INDEX "MachineSession_startedAt_idx" ON "public"."MachineSession"("startedAt");

-- CreateIndex
CREATE INDEX "MachineSession_endedAt_idx" ON "public"."MachineSession"("endedAt");

-- CreateIndex
CREATE INDEX "MachineSession_lastHeartbeatAt_idx" ON "public"."MachineSession"("lastHeartbeatAt");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_receiptId_key" ON "public"."Receipt"("receiptId");

-- CreateIndex
CREATE INDEX "Receipt_machineId_idx" ON "public"."Receipt"("machineId");

-- CreateIndex
CREATE INDEX "Receipt_agentId_idx" ON "public"."Receipt"("agentId");

-- CreateIndex
CREATE INDEX "Receipt_transactionAt_idx" ON "public"."Receipt"("transactionAt");

-- CreateIndex
CREATE INDEX "Receipt_status_idx" ON "public"."Receipt"("status");

-- CreateIndex
CREATE INDEX "Receipt_receiptType_idx" ON "public"."Receipt"("receiptType");

-- CreateIndex
CREATE INDEX "Receipt_transactionCategory_idx" ON "public"."Receipt"("transactionCategory");

-- CreateIndex
CREATE UNIQUE INDEX "AgentFloat_agentId_key" ON "public"."AgentFloat"("agentId");

-- CreateIndex
CREATE INDEX "FloatLedger_agentId_idx" ON "public"."FloatLedger"("agentId");

-- CreateIndex
CREATE INDEX "FloatLedger_receiptId_idx" ON "public"."FloatLedger"("receiptId");

-- CreateIndex
CREATE INDEX "FloatLedger_createdAt_idx" ON "public"."FloatLedger"("createdAt");

-- CreateIndex
CREATE INDEX "FloatLedger_ledgerType_idx" ON "public"."FloatLedger"("ledgerType");

-- CreateIndex
CREATE INDEX "FloatAdjustmentRequest_agentId_idx" ON "public"."FloatAdjustmentRequest"("agentId");

-- CreateIndex
CREATE INDEX "FloatAdjustmentRequest_status_idx" ON "public"."FloatAdjustmentRequest"("status");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "public"."AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_machineId_idx" ON "public"."AuditLog"("machineId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_idx" ON "public"."AuditLog"("entityType");

-- CreateIndex
CREATE INDEX "AuditLog_entityId_idx" ON "public"."AuditLog"("entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "public"."AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "public"."AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_machineSessionId_idx" ON "public"."AuditLog"("machineSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentNumber_key" ON "public"."Payment"("paymentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_invoiceNumber_key" ON "public"."Payment"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Payment_subscriptionId_idx" ON "public"."Payment"("subscriptionId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "public"."Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_paymentMethod_idx" ON "public"."Payment"("paymentMethod");

-- CreateIndex
CREATE INDEX "Payment_paidAt_idx" ON "public"."Payment"("paidAt");

-- CreateIndex
CREATE INDEX "Payment_paymentProvider_idx" ON "public"."Payment"("paymentProvider");

-- CreateIndex
CREATE INDEX "Payment_paymentNumber_idx" ON "public"."Payment"("paymentNumber");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "public"."Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "public"."Notification"("isRead");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "public"."Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "public"."Notification"("type");

-- CreateIndex
CREATE INDEX "Communication_userId_idx" ON "public"."Communication"("userId");

-- CreateIndex
CREATE INDEX "Communication_channel_idx" ON "public"."Communication"("channel");

-- CreateIndex
CREATE INDEX "Communication_status_idx" ON "public"."Communication"("status");

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_bcId_fkey" FOREIGN KEY ("bcId") REFERENCES "public"."BusinessCorrespondent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Agent" ADD CONSTRAINT "Agent_bcId_fkey" FOREIGN KEY ("bcId") REFERENCES "public"."BusinessCorrespondent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Agent" ADD CONSTRAINT "Agent_parentAgentId_fkey" FOREIGN KEY ("parentAgentId") REFERENCES "public"."Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlanPricing" ADD CONSTRAINT "PlanPricing_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Subscription" ADD CONSTRAINT "Subscription_bcId_fkey" FOREIGN KEY ("bcId") REFERENCES "public"."BusinessCorrespondent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Subscription" ADD CONSTRAINT "Subscription_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SubscriptionHistory" ADD CONSTRAINT "SubscriptionHistory_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "public"."Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlanFeature" ADD CONSTRAINT "PlanFeature_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlanFeature" ADD CONSTRAINT "PlanFeature_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "public"."Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Machine" ADD CONSTRAINT "Machine_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Activation" ADD CONSTRAINT "Activation_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "public"."Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Activation" ADD CONSTRAINT "Activation_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "public"."Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MachineSession" ADD CONSTRAINT "MachineSession_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "public"."Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Receipt" ADD CONSTRAINT "Receipt_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "public"."Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Receipt" ADD CONSTRAINT "Receipt_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AgentFloat" ADD CONSTRAINT "AgentFloat_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FloatLedger" ADD CONSTRAINT "FloatLedger_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FloatLedger" ADD CONSTRAINT "FloatLedger_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "public"."Receipt"("receiptId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FloatAdjustmentRequest" ADD CONSTRAINT "FloatAdjustmentRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "public"."Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_machineSessionId_fkey" FOREIGN KEY ("machineSessionId") REFERENCES "public"."MachineSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Payment" ADD CONSTRAINT "Payment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "public"."Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Communication" ADD CONSTRAINT "Communication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
