import { createCodeGeneratorService } from "../../core/services/service.factory";

import ReceiptRepository from "./repository/receipt-upload.repository";

import MachineAuthenticationService from "../machines/runtime/machine-auth.service";
import MachineSessionRepository from "../machines/runtime/machine-session.repository";
import MachineHeartbeatRepository from "../machines/runtime/machine-heartbeat.repository";

import { ReceiptFilter, UploadReceiptRequest } from "./receipt.dto";
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
import MachineRuntimeValidator from "../machines/runtime/machine-runtime-validator";

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
   * Receipt List
   */
  async getReceipts(filter: ReceiptFilter) {
    return withTransaction(async (tx) => {
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
      const repository = new ReceiptListRepository(tx);

      return repository.getStats(filter);
    });
  }

  async export(filter: ReceiptFilter) {
    return withTransaction(async (tx) => {
      const repository = new ReceiptListRepository(tx);

      const receipts = await repository.exportReceipts(filter);

      return generateReceiptWorkbook(receipts);
    });
  }
}
