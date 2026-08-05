// import { PrismaDb } from "../../core/database/prisma.types";

// import ReceiptRepository from "./receipt.repository";

// import MachineAuthenticationService from "../machines/runtime/machine-auth.service";
// import MachineSessionRepository from "../machines/runtime/machine-session.repository";
// import MachineHeartbeatRepository from "../machines/runtime/machine-heartbeat.repository";

// import { UploadReceiptRequest } from "./receipt.dto";
// import { createCodeGeneratorService } from "../../core/services/service.factory";

// export default class ReceiptService {
//   private readonly repository: ReceiptRepository;

//   private readonly authenticationService: MachineAuthenticationService;

//   private readonly sessionRepository: MachineSessionRepository;

//   private readonly heartbeatRepository: MachineHeartbeatRepository;

//   constructor(private readonly db: PrismaDb) {
//     this.repository = new ReceiptRepository(db);

//     this.authenticationService = new MachineAuthenticationService(db);

//     this.sessionRepository = new MachineSessionRepository(db);

//     this.heartbeatRepository = new MachineHeartbeatRepository(db);
//   }

//   async upload(request: UploadReceiptRequest) {
//     const authenticated = await this.authenticationService.authenticate({
//       machineCode: request.machineCode,
//       apiKey: request.apiKey,
//       fingerprint: request.fingerprint,
//     });

//     const session = await this.sessionRepository.findActiveSession(
//       authenticated.machine.id,
//     );

//     if (!session) {
//       throw new Error("No active machine session found.");
//     }

//     if (!authenticated.machine.currentAgentId) {
//       throw new Error("No agent is currently assigned to this machine.");
//     }

//     const codeGenerator = createCodeGeneratorService(this.db);

//     const uploadedReceipts = [];

//     for (const receipt of request.receipts) {
//       const receiptId = await codeGenerator.generateReceiptNumber();

//       const savedReceipt = await this.repository.create({
//         receiptId,

//         machine: {
//           connect: {
//             id: authenticated.machine.id,
//           },
//         },

//         machineSession: {
//           connect: {
//             machineSessionId: session.machineSessionId,
//           },
//         },

//         agent: {
//           connect: {
//             agentId: authenticated.machine.currentAgentId!,
//           },
//         },

//         receiptType: receipt.receiptType,

//         transactionCategory: receipt.transactionCategory,

//         transactionType: receipt.transactionType,

//         status: receipt.status,

//         transactionAt: receipt.transactionAt,

//         amount: receipt.amount,

//         charges: receipt.charges,

//         stan: receipt.stan,

//         rrn: receipt.rrn,

//         terminalId: receipt.terminalId,

//         customerName: receipt.customerName,

//         customerAccount: receipt.customerAccount,

//         location: receipt.location,
//       });

//       uploadedReceipts.push(savedReceipt);
//     }

//     await this.heartbeatRepository.updateHeartbeat(authenticated.machine.id, {
//       lastTransactionAt: new Date(),
//     });

//     // return {
//     //   uploaded: uploadedReceipts.length,
//     //   receipts: uploadedReceipts,
//     // };
//     return {
//       uploaded: uploadedReceipts.length,
//       receiptIds: uploadedReceipts.map((r) => r.receiptId),
//     };
//   }
// }

import { createCodeGeneratorService } from "../../core/services/service.factory";

import ReceiptRepository from "./receipt.repository";

import MachineAuthenticationService from "../machines/runtime/machine-auth.service";
import MachineSessionRepository from "../machines/runtime/machine-session.repository";
import MachineHeartbeatRepository from "../machines/runtime/machine-heartbeat.repository";

import { UploadReceiptRequest } from "./receipt.dto";
import { withTransaction } from "../../core/database/transaction";

import { FloatLedgerType, ReceiptStatus } from "../../generated/prisma/enums";
import FloatLedgerService from "../float/float-ledger.service";

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

      //   const uploadedReceipts = [];

      //   // Save Receipts
      //   for (const receipt of request.receipts) {
      //     const savedReceipt = await repository.create({
      //       receiptId: receipt.receiptId,

      //       machine: {
      //         connect: {
      //           id: authenticated.machine.id,
      //         },
      //       },

      //       machineSession: {
      //         connect: {
      //           machineSessionId: session.machineSessionId,
      //         },
      //       },

      //       agent: {
      //         connect: {
      //           agentId: authenticated.machine.currentAgentId,
      //         },
      //       },

      //       receiptType: receipt.receiptType,

      //       transactionCategory: receipt.transactionCategory,

      //       transactionType: receipt.transactionType,

      //       status: receipt.status,

      //       transactionAt: receipt.transactionAt,

      //       amount: receipt.amount,

      //       charges: receipt.charges,

      //       stan: receipt.stan,

      //       rrn: receipt.rrn,

      //       terminalId: receipt.terminalId,

      //       customerName: receipt.customerName,

      //       customerAccount: receipt.customerAccount,

      //       location: receipt.location,
      //     });

      //     uploadedReceipts.push(savedReceipt);
      //   }

      //   const uploadedReceipts = [];
      //   const skippedReceipts: string[] = [];

      //   for (const receipt of request.receipts) {
      //     const existingReceipt = await repository.findByReceiptId(
      //       receipt.receiptId,
      //     );

      //     if (existingReceipt) {
      //       skippedReceipts.push(receipt.receiptId);
      //       continue;
      //     }

      //     const savedReceipt = await repository.create({
      //       receiptId: receipt.receiptId,

      //       machine: {
      //         connect: {
      //           id: authenticated.machine.id,
      //         },
      //       },

      //       machineSession: {
      //         connect: {
      //           machineSessionId: session.machineSessionId,
      //         },
      //       },

      //       agent: {
      //         connect: {
      //           agentId: authenticated.machine.currentAgentId,
      //         },
      //       },

      //       receiptType: receipt.receiptType,

      //       transactionCategory: receipt.transactionCategory,

      //       transactionType: receipt.transactionType,

      //       status: receipt.status,

      //       transactionAt: receipt.transactionAt,

      //       amount: receipt.amount,

      //       charges: receipt.charges,

      //       stan: receipt.stan,

      //       rrn: receipt.rrn,

      //       terminalId: receipt.terminalId,

      //       customerName: receipt.customerName,

      //       customerAccount: receipt.customerAccount,

      //       location: receipt.location,
      //     });

      //     uploadedReceipts.push(savedReceipt);
      //   }

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
}
