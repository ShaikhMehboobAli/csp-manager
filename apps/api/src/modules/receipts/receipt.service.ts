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
import { withTransaction } from "../../core/database/transaction";

import {
  ActivationStatus,
  FloatLedgerType,
  MachineStatus,
  ReceiptStatus,
  SubscriptionStatus,
} from "../../generated/prisma/enums";
import FloatLedgerService from "../float/float-ledger.service";
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
import {
  DesktopFeature,
} from "../subscriptions/subscription-entitlement.service";
import SubscriptionEntitlementService from "../subscriptions/subscription-entitlement.service";

export default class ReceiptService {
  async upload(request: UploadReceiptRequest) {
    return withTransaction(async (tx) => {
      const repository = new ReceiptRepository(tx);

      const authenticationService = new MachineAuthenticationService(tx);

      const sessionRepository = new MachineSessionRepository(tx);

      const heartbeatRepository = new MachineHeartbeatRepository(tx);

      const floatLedgerService = new FloatLedgerService(tx);

      const codeGenerator = createCodeGeneratorService(tx);

      // Authenticate Machine
      const authenticated = await authenticationService.authenticate({
        machineCode: request.machineCode,
        apiKey: request.apiKey,
        fingerprint: request.fingerprint,
      });

      MachineRuntimeValidator.validateReceiptUpload(authenticated);

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
        throw new Error("No agent is currently assigned to this machine.");
      }

      // Find Active Machine Session
      const session = await sessionRepository.findActiveSession(
        authenticated.machine.id,
      );

      if (!session) {
        throw new Error("No active machine session found.");
      }

      const uploadedReceipts = [];

      const skippedReceipts: Array<{
        receiptId: string;
        reason: string;
      }> = [];

      const processedReceiptIds = new Set<string>();

      const existingReceiptIds = await repository.findExistingReceiptIds(
        request.receipts.map((receipt) => receipt.receiptId),
      );

      for (const receipt of request.receipts) {
        if (processedReceiptIds.has(receipt.receiptId)) {
          skippedReceipts.push({
            receiptId: receipt.receiptId,
            reason: "Duplicate receipt in request.",
          });

          continue;
        }

        processedReceiptIds.add(receipt.receiptId);

        if (existingReceiptIds.has(receipt.receiptId)) {
          skippedReceipts.push({
            receiptId: receipt.receiptId,
            reason: "Receipt already exists.",
          });

          continue;
        }

        const savedReceipt = await repository.create({
          receiptId: receipt.receiptId,

          machine: {
            connect: {
              id: authenticated.machine.id,
            },
          },

          machineSession: {
            connect: {
              machineSessionId: session.machineSessionId,
            },
          },

          agent: {
            connect: {
              agentId: authenticated.machine.currentAgentId,
            },
          },

          receiptType: receipt.receiptType,

          transactionCategory: receipt.transactionCategory,

          transactionType: receipt.transactionType,

          status: receipt.status,

          transactionAt: receipt.transactionAt,

          amount: receipt.amount,

          charges: receipt.charges,

          stan: receipt.stan,

          rrn: receipt.rrn,

          terminalId: receipt.terminalId,

          customerName: receipt.customerName,

          customerAccount: receipt.customerAccount,

          location: receipt.location,
        });

        let ledgerCreated = savedReceipt.status === ReceiptStatus.SUCCESS;

        if (ledgerCreated) {
          await floatLedgerService.record({
            agentId: authenticated.machine.currentAgentId,

            receiptId: savedReceipt.receiptId,

            ledgerType: FloatLedgerType.RECEIPT,

            transactionCategory: savedReceipt.transactionCategory,

            amount: Number(savedReceipt.amount),

            remarks: "Receipt uploaded from ReceiptWatcher",
          });

          ledgerCreated = true;
        }

        // uploadedReceipts.push(savedReceipt);
        uploadedReceipts.push({
          receipt: savedReceipt,

          ledgerCreated: ledgerCreated,
        });
      }

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
          uploadedReceipts,
          skippedReceipts,
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
      const floatLedgerService = new FloatLedgerService(tx);

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

      const assignedCsp = await repository.findAssignedCsp(request.agentId);

      if (!assignedCsp) {
        throw new BadRequestError("The assigned CSP agent is not valid.");
      }

      const session = await sessionRepository.findActiveSession(
        authenticated.machine.id,
      );

      if (!session) {
        throw new BadRequestError("No active machine session found.");
      }

      const acceptedReceipts: Array<{ receiptId: string; count: 1 }> = [];
      const skippedReceipts: Array<{ receiptId: string; reason: string }> = [];
      const processedReceiptIds = new Set<string>();

      for (const receipt of request.receipts) {
        if (processedReceiptIds.has(receipt.receiptId)) {
          skippedReceipts.push({
            receiptId: receipt.receiptId,
            reason: "Duplicate receipt in request.",
          });
          continue;
        }

        processedReceiptIds.add(receipt.receiptId);

        // PostgreSQL enforces receiptId uniqueness. createMany + skipDuplicates
        // makes concurrent retries idempotent without leaving this transaction
        // in an error state after a unique-constraint conflict.
        const wasCreated = await repository.createIfAbsent({
          receiptId: receipt.receiptId,
          machineId: authenticated.machine.id,
          machineSessionId: session.machineSessionId,
          agentId: request.agentId,
          receiptType: receipt.receiptType,
          transactionCategory: receipt.transactionCategory,
          transactionType: receipt.transactionType,
          status: ReceiptStatus.SUCCESS,
          // Dashboards and reports filter by transactionAt, so fall back to
          // receive time; the desktop uploads right after bank confirmation.
          transactionAt: receipt.transactionAt ?? new Date(),
          amount: receipt.amount,
          rrn: receipt.rrn,
          location: receipt.location,
          count: receipt.count,
        });

        if (!wasCreated) {
          skippedReceipts.push({
            receiptId: receipt.receiptId,
            reason: "Receipt already exists.",
          });
          continue;
        }

        const savedReceipt = await repository.findByReceiptId(receipt.receiptId);

        if (!savedReceipt) {
          throw new Error("Accepted receipt could not be read after creation.");
        }

        if (receipt.cashDenomination) {
          await repository.createCashDenomination(
            savedReceipt.id,
            receipt.cashDenomination,
          );
        }

        await floatLedgerService.record({
          agentId: request.agentId,
          receiptId: savedReceipt.receiptId,
          ledgerType: FloatLedgerType.RECEIPT,
          transactionCategory: savedReceipt.transactionCategory,
          amount: receipt.amount,
          remarks: "Minimal receipt uploaded from CSP Manager",
        });

        acceptedReceipts.push({
          receiptId: savedReceipt.receiptId,
          count: 1,
        });
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
        skippedReceipts: result.skippedReceipts,
      },
    };
  }

  /**
   * Receipt List
   */
  async getReceipts(filter: ReceiptFilter) {
    return withTransaction(async (tx) => {
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

  async getReceipt(receiptId: string, agentIds: string[]) {
    return withTransaction(async (tx) => {
      // check for subscription and access validation

      // const resolver = new SubscriptionResolver(tx);

      // const subscription = await resolver.resolveForAgent(
      //   filter.currentAgentId,
      // );

      // SubscriptionAccessValidator.validate(subscription);

      const repository = new ReceiptDetailRepository(tx);

      const receipt = await repository.getReceipt(receiptId, agentIds);

      if (!receipt) {
        throw new NotFoundError("Receipt not found.");
      }

      return mapReceiptDetail(receipt);
    });
  }

  async getStats(filter: ReceiptFilter) {
    return withTransaction(async (tx) => {
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
    return withTransaction(async (tx) => {
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
