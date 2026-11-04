import { skipReasonCode } from "../../core/errors/error-codes";
import { createCodeGeneratorService } from "../../core/services/service.factory";
import prisma from "../../config/prisma";

import ReceiptRepository from "./repository/receipt-upload.repository";

import MachineAuthenticationService from "../machines/runtime/machine-auth.service";
import MachineSessionRepository from "../machines/runtime/machine-session.repository";
import MachineHeartbeatRepository from "../machines/runtime/machine-heartbeat.repository";

import {
  ReceiptFilter,
  UploadReceiptCountsPayload,
  UploadReceiptRequest,
} from "./receipt.dto";
import { withTransaction, withReadOnly } from "../../core/database/transaction";
import ReceiptFieldsSettingsService from "../settings/receipt-fields-settings.service";
import CommissionService, { rateLabel } from "../commission/commission.service";
import ReceiptDailyCountRepository from "./repository/receipt-daily-count.repository";
import { receiptUploadCutoff } from "./receipt-retention.service";

import {
  ActivationStatus,
  MachineStatus,
  ReceiptStatus,
  SubscriptionStatus,
} from "../../generated/prisma/enums";
import CashService, { ReceiptCashResult } from "../cash/cash.service";
import ReceiptListRepository from "./repository/receipt-list.repository";
import { mapReceiptDetail, mapReceiptList } from "./receipt.mapper";
import ReceiptDetailRepository from "./repository/receipt-detail.repository";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { generateReceiptWorkbook } from "../reports/helper/report-export.helper";
import { ForbiddenError } from "../../core/errors/ForbiddenError";
import { BadRequestError } from "../../core/errors/BadRequestError";
import MachineRuntimeValidator from "../machines/runtime/machine-runtime-validator";
import SubscriptionResolver from "../subscriptions/subscription-validator/subscription-resolver.service";
import SubscriptionAccessValidator from "../subscriptions/subscription-validator/subscription-access-validator";
import { DesktopFeature } from "../subscriptions/subscription-entitlement.service";
import SubscriptionEntitlementService from "../subscriptions/subscription-entitlement.service";
import { resolveReceiptWatcher } from "../machines/runtime/receipt-watcher-policy";
import { MinimalReceipt, parseMinimalReceipt } from "./receipt.validation";

const RECEIPT_TOO_OLD_REASON =
  "Receipt is older than the receipt retention period.";


/** Adds the stable `code` of a skip reason (e.g. RECEIPT_ALREADY_EXISTS). */
const withReasonCode = <T extends { reason: string }>(item: T) => ({
  ...item,
  code: skipReasonCode(item.reason),
});

export default class ReceiptService {
  async upload(request: UploadReceiptRequest) {
    return withTransaction(async (tx) => {
      const repository = new ReceiptRepository(tx);

      const authenticationService = new MachineAuthenticationService(tx);

      const sessionRepository = new MachineSessionRepository(tx);

      const heartbeatRepository = new MachineHeartbeatRepository(tx);


      const codeGenerator = createCodeGeneratorService(tx);

      // Authenticate Machine
      const authenticated = await authenticationService.authenticate({
        machineCode: request.machineCode,
        apiKey: request.apiKey,
        fingerprint: request.fingerprint,
      });

      MachineRuntimeValidator.validateReceiptUpload(authenticated);

      // Full receipts come only from the background watcher, which is limited
      // to BC plans whose CSP has no subscription of its own.
      const watcher = await resolveReceiptWatcher(tx, authenticated);

      if (!watcher.receiptWatcherAllowed) {
        throw new ForbiddenError(
          "Receipt watcher is not allowed for this machine. Receipts are counted by CSP Manager.",
        );
      }

      // const machine = authenticated.machine;
      // const activation = authenticated.activation;
      // const subscription = authenticated.subscription;

      // // Machine enabled?
      // if (!machine.watcherEnabled) {
      //   throw new ForbiddenError(
      //     "Receipt Watcher has been disabled for this machine.",
      //   );
      // }

      // // Machine active?
      // if (machine.status !== MachineStatus.ACTIVE) {
      //   throw new ForbiddenError("Machine is inactive.");
      // }

      // // Activation active?
      // if (activation.status !== ActivationStatus.ACTIVE) {
      //   throw new ForbiddenError("Machine activation is inactive.");
      // }

      // // Subscription active?
      // if (subscription.status !== SubscriptionStatus.ACTIVE) {
      //   throw new ForbiddenError("Subscription is inactive.");
      // }

      if (!authenticated.machine.currentAgentId) {
        throw new ForbiddenError(
          "No agent is currently assigned to this machine.",
        );
      }

      // Find Active Machine Session
      const session = await sessionRepository.findActiveSession(
        authenticated.machine.id,
      );

      if (!session) {
        throw new BadRequestError("No active machine session found.");
      }

      const uploadedReceipts = [];

      const skippedReceipts: Array<{
        receiptId: string;
        reason: string;
      }> = [];

      const processedReceiptIds = new Set<string>();

      const agentId = authenticated.machine.currentAgentId;

      const toCreate: typeof request.receipts = [];

      const retentionCutoff = await receiptUploadCutoff(tx);

      for (const receipt of request.receipts) {
        if (receipt.transactionAt < retentionCutoff) {
          skippedReceipts.push({
            receiptId: receipt.receiptId,
            reason: RECEIPT_TOO_OLD_REASON,
          });

          continue;
        }

        if (processedReceiptIds.has(receipt.receiptId)) {
          skippedReceipts.push({
            receiptId: receipt.receiptId,
            reason: "Duplicate receipt in request.",
          });

          continue;
        }

        processedReceiptIds.add(receipt.receiptId);

        toCreate.push(receipt);
      }

      // Commission the CSP earns on each (rate frozen now).
      const commissions = await new CommissionService(tx).computeForReceipts(agentId, toCreate);

      // One insert for the batch; existing (agentId, receiptId) are skipped.
      const allowedFields = await new ReceiptFieldsSettingsService().allowed();

      const created = await repository.createManyAndReturnIfAbsent(
        toCreate.map((receipt, index) => ({
          ...commissions[index],
          ...ReceiptFieldsSettingsService.strip(
            {
              stan: receipt.stan,
              rrn: receipt.rrn,
              terminalId: receipt.terminalId,
              customerName: receipt.customerName,
              customerAccount: receipt.customerAccount,
              location: receipt.location,
              bankName: receipt.bankName,
              balanceAfter: receipt.balanceAfter,
              bankTransactionId: receipt.bankTransactionId,
              bankResponseCode: receipt.bankResponseCode,
              bankResponseMessage: receipt.bankResponseMessage,
            },
            allowedFields,
          ),
          receiptId: receipt.receiptId,
          machineId: authenticated.machine.id,
          machineSessionId: session.machineSessionId,
          agentId,
          receiptType: receipt.receiptType,
          transactionCategory: receipt.transactionCategory,
          transactionType: receipt.transactionType,
          status: receipt.status,
          transactionAt: receipt.transactionAt,
          amount: receipt.amount,
          charges: receipt.charges,
        })),
      );

      await new ReceiptDailyCountRepository(tx).record(created);

      const createdById = new Map(
        created.map((receipt) => [receipt.receiptId, receipt]),
      );

      const cashReceipts: Parameters<CashService["applyReceipts"]>[1] = [];

      for (const receipt of toCreate) {
        const savedReceipt = createdById.get(receipt.receiptId);

        if (!savedReceipt) {
          skippedReceipts.push({
            receiptId: receipt.receiptId,
            reason: "Receipt already exists.",
          });

          continue;
        }

        // Only successful transactions move cash.
        if (savedReceipt.status === ReceiptStatus.SUCCESS) {
          cashReceipts.push({
            receiptRecordId: savedReceipt.id,
            transactionCategory: savedReceipt.transactionCategory,
            amount: savedReceipt.amount,
          });
        }

        uploadedReceipts.push({ receipt: savedReceipt });
      }

      const cash = await new CashService(tx).applyReceipts(
        agentId,
        cashReceipts,
        { type: "MACHINE", id: authenticated.machine.machineCode },
      );

      const withCash = uploadedReceipts.map((item) => ({
        ...item,
        ledgerCreated: cash.get(item.receipt.id)?.status === "APPLIED",
        cash: cash.get(item.receipt.id) ?? null,
      }));

      // Update Machine
      await heartbeatRepository.updateLastTransactionAt(
        authenticated.machine.id,
        new Date(),
      );

      return {
        success: true,
        message: "Receipt upload completed successfully.",
        data: {
          total: request.receipts.length,
          uploaded: uploadedReceipts.length,
          skipped: skippedReceipts.length,
          uploadedReceipts: withCash,
          skippedReceipts: skippedReceipts.map(withReasonCode),
        },
      };
    });
  }

  /**
   * Uploads minimal, confirmed desktop transactions. This intentionally has a
   * separate contract from the legacy receipt upload route.
   */
  async uploadCounts(request: UploadReceiptCountsPayload) {
    const result = await withTransaction(async (tx) => {
      const repository = new ReceiptRepository(tx);
      const authenticationService = new MachineAuthenticationService(tx);
      const sessionRepository = new MachineSessionRepository(tx);
      const heartbeatRepository = new MachineHeartbeatRepository(tx);

      const authenticated = await authenticationService.authenticate({
        machineCode: request.machineCode,
        apiKey: request.apiKey,
        fingerprint: request.fingerprint,
      });

      MachineRuntimeValidator.validateReceiptUpload(authenticated);

      const entitlementService = new SubscriptionEntitlementService(tx);

      await entitlementService.requireFeatures(
        authenticated.subscription.planId,
        [DesktopFeature.AUTOMATION, DesktopFeature.RECEIPT_SYNC],
      );

      if (authenticated.machine.currentAgentId !== request.agentId) {
        throw new ForbiddenError(
          "The supplied agent does not match this machine's assignment.",
        );
      }

      const assignedAgent = await repository.findAssignedAgent(request.agentId);

      if (!assignedAgent) {
        throw new BadRequestError("The assigned agent is not valid.");
      }

      const session = await sessionRepository.findActiveSession(
        authenticated.machine.id,
      );

      if (!session) {
        throw new BadRequestError("No active machine session found.");
      }

      const acceptedReceipts: Array<{
        receiptId: string;
        count: 1;
        cash?: ReceiptCashResult;
      }> = [];
      const skippedReceipts: Array<{
        receiptId: string | null;
        reason: string;
      }> = [];
      const processedReceiptIds = new Set<string>();
      const valid: (MinimalReceipt & { transactionAt: Date })[] = [];
      const receivedAt = new Date();
      const retentionCutoff = await receiptUploadCutoff(tx, receivedAt);

      for (const raw of request.receipts) {
        const parsed = parseMinimalReceipt(raw);

        if (!parsed.success) {
          skippedReceipts.push({
            receiptId: parsed.receiptId,
            reason: parsed.reason,
          });
          continue;
        }

        if (processedReceiptIds.has(parsed.receipt.receiptId)) {
          skippedReceipts.push({
            receiptId: parsed.receipt.receiptId,
            reason: "Duplicate receipt in request.",
          });
          continue;
        }

        // Dashboards and reports filter by transactionAt, so fall back to
        // receive time; the desktop uploads right after bank confirmation.
        const transactionAt = parsed.receipt.transactionAt ?? receivedAt;

        if (transactionAt < retentionCutoff) {
          skippedReceipts.push({
            receiptId: parsed.receipt.receiptId,
            reason: RECEIPT_TOO_OLD_REASON,
          });
          continue;
        }

        processedReceiptIds.add(parsed.receipt.receiptId);
        valid.push({ ...parsed.receipt, transactionAt });
      }

      // One insert for the whole batch. PostgreSQL enforces (agentId,
      // receiptId) uniqueness; skipDuplicates leaves existing receipts out
      // of the result (so concurrent retries stay idempotent) without putting
      // the transaction in an error state.
      const commissions = await new CommissionService(tx).computeForReceipts(
        request.agentId,
        valid.map((receipt) => ({ ...receipt, status: ReceiptStatus.SUCCESS })),
      );

      const allowedFields = await new ReceiptFieldsSettingsService().allowed();

      const created = await repository.createManyIfAbsent(
        valid.map((receipt, index) => ({
          ...commissions[index],
          ...ReceiptFieldsSettingsService.strip(
            {
              rrn: receipt.rrn,
              location: receipt.location,
              stan: receipt.stan,
              terminalId: receipt.terminalId,
              customerName: receipt.customerName,
              customerAccount: receipt.customerAccount,
              bankName: receipt.bankName,
              balanceAfter: receipt.balanceAfter,
              bankTransactionId: receipt.bankTransactionId,
              bankResponseCode: receipt.bankResponseCode,
              bankResponseMessage: receipt.bankResponseMessage,
            },
            allowedFields,
          ),
          receiptId: receipt.receiptId,
          machineId: authenticated.machine.id,
          machineSessionId: session.machineSessionId,
          agentId: request.agentId,
          receiptType: receipt.receiptType,
          transactionCategory: receipt.transactionCategory,
          transactionType: receipt.transactionType,
          status: ReceiptStatus.SUCCESS,
          transactionAt: receipt.transactionAt,
          amount: receipt.amount,
          count: receipt.count,
        })),
      );

      await new ReceiptDailyCountRepository(tx).record(created);

      const createdIds = new Map(
        created.map((receipt) => [receipt.receiptId, receipt.id]),
      );

      const saved: { receipt: MinimalReceipt; id: string }[] = [];

      for (const receipt of valid) {
        const id = createdIds.get(receipt.receiptId);

        if (!id) {
          skippedReceipts.push({
            receiptId: receipt.receiptId,
            reason: "Receipt already exists.",
          });
          continue;
        }

        saved.push({ receipt, id });

        acceptedReceipts.push({ receiptId: receipt.receiptId, count: 1 });
      }

      await repository.createCashDenominations(
        saved.flatMap(({ receipt, id }) =>
          receipt.cashDenomination
            ? [{ receiptRecordId: id, ...receipt.cashDenomination }]
            : [],
        ),
      );

      // In request order, so running balances follow the upload order.
      const cash = await new CashService(tx).applyReceipts(
        request.agentId,
        saved.map(({ receipt, id }) => ({
          receiptRecordId: id,
          transactionCategory: receipt.transactionCategory,
          amount: receipt.amount,
          cashDenomination: receipt.cashDenomination,
        })),
        { type: "MACHINE", id: authenticated.machine.machineCode },
      );

      // Cash receipts say whether they changed the balances.
      for (const [index, { id }] of saved.entries()) {
        const result = cash.get(id);

        if (result) {
          acceptedReceipts[index].cash = result;
        }
      }

      if (acceptedReceipts.length > 0) {
        await heartbeatRepository.updateLastTransactionAt(
          authenticated.machine.id,
          new Date(),
        );
      }

      return {
        acceptedReceipts,
        skippedReceipts,
      };
    });

    // Read-only totals run after commit, outside the transaction, so they
    // include this upload and don't count against the transaction timeout.
    const totalCount = await new ReceiptRepository(prisma).getCumulativeCounts(
      request.agentId,
    );

    return {
      success: true,
      message: "Receipt upload completed successfully.",
      data: {
        acceptedCount: result.acceptedReceipts.length,
        acceptedRecords: result.acceptedReceipts.length,
        skipped: result.skippedReceipts.length,
        totalCount,
        acceptedReceipts: result.acceptedReceipts,
        skippedReceipts: result.skippedReceipts.map(withReasonCode),
      },
    };
  }

  /**
   * Receipt List
   */
  async getReceipts(filter: ReceiptFilter) {
    return withReadOnly(async (tx) => {
      // check for subscription and access validation

      const resolver = new SubscriptionResolver(tx);

      const subscription = await resolver.getEffectiveSubscription(
        filter.currentAgentId,
      );

      SubscriptionAccessValidator.validate(subscription);

      const repository = new ReceiptListRepository(tx);

      const result = await repository.getReceipts(filter);

      return {
        items: mapReceiptList(result.items),

        pagination: result.pagination,
      };
    });
  }

  async getReceipt(
    receiptId: string,
    agentIds: string[],
    currentAgentId: string,
  ) {
    return withReadOnly(async (tx) => {
      const subscription = await new SubscriptionResolver(
        tx,
      ).getEffectiveSubscription(currentAgentId);

      SubscriptionAccessValidator.validate(subscription);

      const repository = new ReceiptDetailRepository(tx);

      const receipt = await repository.getReceipt(receiptId, agentIds);

      if (!receipt) {
        throw new NotFoundError("Receipt not found.");
      }

      const canViewCash = await new SubscriptionEntitlementService(
        tx,
      ).canViewCashManagement(subscription);

      const rate = receipt.commissionRateId
        ? await tx.commissionRate.findUnique({ where: { id: receipt.commissionRateId } })
        : null;

      const detail = mapReceiptDetail({ ...receipt, commissionRateLabel: rateLabel(rate) });

      // Cash denomination is part of CASH_MANAGEMENT on CSP plans.
      return canViewCash ? detail : { ...detail, cashDenomination: null };
    });
  }

  async getStats(filter: ReceiptFilter) {
    return withReadOnly(async (tx) => {
      // check for subscription and access validation

      const resolver = new SubscriptionResolver(tx);

      const subscription = await resolver.getEffectiveSubscription(
        filter.currentAgentId,
      );

      SubscriptionAccessValidator.validate(subscription);

      const repository = new ReceiptListRepository(tx);

      return repository.getStats(filter);
    });
  }

  async export(filter: ReceiptFilter) {
    return withReadOnly(async (tx) => {
      // check for subscription and access validation

      const resolver = new SubscriptionResolver(tx);

      const subscription = await resolver.getEffectiveSubscription(
        filter.currentAgentId,
      );

      SubscriptionAccessValidator.validate(subscription);

      const repository = new ReceiptListRepository(tx);

      const receipts = await repository.exportReceipts(filter);

      return generateReceiptWorkbook(receipts);
    });
  }
}
