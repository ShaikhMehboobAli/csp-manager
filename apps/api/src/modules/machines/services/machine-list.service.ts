import { withTransaction } from "../../../core/database/transaction";
import { NotFoundError } from "../../../core/errors/NotFoundError";
import { CurrentUser } from "../../../core/types/auth.types";
import { normalizeDateRange } from "../../../core/utils/date-range.helper";

import AgentScopeService from "../../agents/service/agent-scope.service";
import { getMachineStatus } from "../../dashboard/dashboard.helper";
import SubscriptionAccessValidator from "../../subscriptions/subscription-validator/subscription-access-validator";
import SubscriptionResolver from "../../subscriptions/subscription-validator/subscription-resolver.service";
import {
  buildMachineMap,
  buildServiceMap,
  buildTransactionMap,
} from "../machine.helper";
import { mapMachineList } from "../machine.mapper";
import SubscriptionEntitlementService from "../../subscriptions/subscription-entitlement.service";

import MachineListRepository from "../repository/machine-list.repository";
import MachineSessionRepository from "../runtime/machine-session.repository";
import { MachineDetailFilter, MachineListFilter } from "../types/machine.types";

export default class MachineListService {
  async getMachines(user: CurrentUser, filter: MachineListFilter) {
    console.log(filter);
    return withTransaction(async (tx) => {
      const resolver = new SubscriptionResolver(tx);

      const subscription = await resolver.getEffectiveSubscription(
        user.agentId,
      );

      SubscriptionAccessValidator.validate(subscription);

      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(user);

      const repository = new MachineListRepository(tx);

      const [
        machineResult,
        transactionSummary,
        serviceSummary,
        machineSummary,
      ] = await Promise.all([
        // repository.getMachines(agentIds),
        repository.getMachines(agentIds, undefined, filter),

        repository.getTransactionSummary(agentIds, filter),

        repository.getServiceSummary(agentIds, filter),

        repository.getMachineSummary(agentIds),
      ]);

      const items = mapMachineList(
        machineResult.items,
        buildTransactionMap(transactionSummary),
        buildServiceMap(serviceSummary),
        buildMachineMap(machineSummary),
      );

      // Float figures are null for CSP plans without CASH_MANAGEMENT.
      const canViewFloat = await new SubscriptionEntitlementService(
        tx,
      ).canViewCashManagement(subscription);

      return {
        items: canViewFloat
          ? items
          : items.map((item) => ({ ...item, float: null })),

        pagination: machineResult.pagination,
      };
    });
  }

  // async getMachine(
  //   machineId: string,
  //   user: CurrentUser,
  //   filter: MachineDetailFilter,
  // ) {
  //   return withTransaction(async (tx) => {
  //     // check for subscription and access validation
  //     const resolver = new SubscriptionResolver(tx);

  //     const subscription = await resolver.getEffectiveSubscription(
  //       user.agentId,
  //     );

  //     SubscriptionAccessValidator.validate(subscription);

  //     const { from, to } = normalizeDateRange(filter.from, filter.to);

  //     // continue with the transaction and fetch machines
  //     const scopeService = new AgentScopeService(tx);

  //     const agentIds = await scopeService.getAgentScope(user);

  //     const repository = new MachineListRepository(tx);

  //     const machine = await repository.getMachine(machineId, agentIds);

  //     if (!machine) {
  //       throw new NotFoundError("Machine not found.");
  //     }

  //     const parentAgent =
  //       machine.agent?.type === "KO"
  //         ? machine.agent.parentAgentId
  //         : machine.agent?.agentId;

  //     if (!parentAgent) {
  //       throw new NotFoundError("Parent Agent not found.");
  //     }

  //     const scopedAgents = await tx.agent.findMany({
  //       where: {
  //         isDeleted: false,

  //         OR: [
  //           {
  //             agentId: parentAgent,
  //           },
  //           {
  //             parentAgentId: parentAgent,
  //             type: "KO",
  //           },
  //         ],
  //       },

  //       select: {
  //         id: true,
  //         agentId: true,
  //         name: true,
  //         type: true,
  //         mobile: true,
  //         email: true,
  //         address: true,
  //         bcId: true,
  //         parentAgentId: true,
  //         linkedAt: true,
  //         createdAt: true,
  //         updatedAt: true,
  //       },

  //       orderBy: {
  //         type: "asc",
  //       },
  //     });

  //     const scopedAgentIds = scopedAgents
  //       .map((agent) => agent.agentId)
  //       .filter((id): id is string => Boolean(id));

  //     const childMachines = await tx.machine.findMany({
  //       where: {
  //         agentId: {
  //           in: scopedAgentIds,
  //         },

  //         isDeleted: false,
  //       },

  //       select: {
  //         id: true,
  //         agentId: true,
  //         lastHeartbeatAt: true,
  //         lastTransactionAt: true,
  //       },
  //     });

  //     const childTransactionRows =
  //       scopedAgentIds.length === 0
  //         ? []
  //         : await tx.receipt.groupBy({
  //             by: ["agentId", "status"],

  //             where: {
  //               agentId: {
  //                 in: scopedAgentIds,
  //               },

  //               transactionAt: {
  //                 gte: from,
  //                 lte: to,
  //               },
  //             },

  //             _count: {
  //               id: true,
  //             },

  //             _sum: {
  //               amount: true,
  //             },
  //           });

  //     const childTransactionMap = new Map<
  //       string,
  //       {
  //         count: number;
  //         amount: number;
  //         success: number;
  //         failed: number;
  //       }
  //     >();

  //     for (const row of childTransactionRows) {
  //       const existing = childTransactionMap.get(row.agentId) ?? {
  //         count: 0,
  //         amount: 0,
  //         success: 0,
  //         failed: 0,
  //       };

  //       const count = row._count.id;
  //       const amount = Number(row._sum.amount ?? 0);

  //       existing.count += count;
  //       existing.amount += amount;

  //       if (row.status === "SUCCESS") {
  //         existing.success += count;
  //       } else if (row.status === "FAILED") {
  //         existing.failed += count;
  //       }

  //       childTransactionMap.set(row.agentId, existing);
  //     }

  //     const childServiceRows =
  //       scopedAgentIds.length === 0
  //         ? []
  //         : await tx.receipt.groupBy({
  //             by: ["agentId", "transactionCategory", "receiptType", "status"],

  //             where: {
  //               agentId: {
  //                 in: scopedAgentIds,
  //               },

  //               transactionAt: {
  //                 gte: from,
  //                 lte: to,
  //               },
  //             },

  //             _count: {
  //               id: true,
  //             },

  //             _sum: {
  //               amount: true,
  //             },

  //             orderBy: {
  //               transactionCategory: "asc",
  //             },
  //           });

  //     const childServiceMap = new Map<
  //       string,
  //       Array<{
  //         transactionCategory: string;
  //         receiptType: string;
  //         successCount: number;
  //         failedCount: number;
  //         successAmount: number;
  //         failedAmount: number;
  //       }>
  //     >();

  //     for (const row of childServiceRows) {
  //       const services = childServiceMap.get(row.agentId) ?? [];

  //       let service = services.find(
  //         (item) =>
  //           item.transactionCategory === row.transactionCategory &&
  //           item.receiptType === row.receiptType,
  //       );

  //       if (!service) {
  //         service = {
  //           transactionCategory: row.transactionCategory,

  //           receiptType: row.receiptType,

  //           successCount: 0,
  //           failedCount: 0,

  //           successAmount: 0,
  //           failedAmount: 0,
  //         };

  //         services.push(service);
  //       }

  //       const count = row._count.id;

  //       const amount = Number(row._sum.amount ?? 0);

  //       if (row.status === "SUCCESS") {
  //         service.successCount += count;
  //         service.successAmount += amount;
  //       } else if (row.status === "FAILED") {
  //         service.failedCount += count;
  //         service.failedAmount += amount;
  //       }

  //       childServiceMap.set(row.agentId, services);
  //     }

  //     const children = scopedAgents.map((agent) => {
  //       const transaction = childTransactionMap.get(agent.agentId) ?? {
  //         count: 0,
  //         amount: 0,
  //         success: 0,
  //         failed: 0,
  //       };

  //       const agentMachine = childMachines.find(
  //         (machine) => machine.agentId === agent.agentId,
  //       );

  //       return {
  //         id: agent.id,

  //         agentId: agent.agentId,

  //         name: agent.name,

  //         type: agent.type,

  //         mobile: agent.mobile,

  //         email: agent.email,

  //         address: agent.address,

  //         bcId: agent.bcId,

  //         parentAgentId: agent.parentAgentId,

  //         linkedAt: agent.linkedAt,

  //         createdAt: agent.createdAt,

  //         updatedAt: agent.updatedAt,

  //         machine: {
  //           lastHeartbeatAt: agentMachine?.lastHeartbeatAt ?? null,

  //           lastReceiptCapturedAt: agentMachine?.lastTransactionAt ?? null,
  //         },

  //         transaction: {
  //           count: transaction.count,

  //           amount: transaction.amount,

  //           success: transaction.success,

  //           failed: transaction.failed,
  //         },

  //         services: childServiceMap.get(agent.agentId) ?? [],
  //       };
  //     });

  //     console.log("[MachineDetail] CSP scope root:", {
  //       machineAgentId: machine.agent?.agentId,
  //       machineAgentType: machine.agent?.type,
  //       parentAgent,
  //     });

  //     const sessionRepository = new MachineSessionRepository(tx);

  //     const activeSession = await sessionRepository.findActiveSession(
  //       machine.id,
  //     );

  //     const sessions = await sessionRepository.findSessionsForRange(
  //       machine.id,
  //       from,
  //       to,
  //     );

  //     const onlineHours = this.calculateRuntimeHours(sessions, from, to);

  //     // return {
  //     //   machineId: machine.id,

  //     //   machineCode: machine.machineCode,

  //     //   machineName: machine.machineName,

  //     //   fingerprint: machine.fingerprint,

  //     //   agentId: machine.agent?.agentId,

  //     //   agentName: machine.agent?.name,

  //     //   watcherVersion: machine.watcherVersion,

  //     //   watcherEnabled: machine.watcherEnabled,

  //     //   machineStatus: machine.status,

  //     //   connectionStatus: getMachineStatus(machine.lastHeartbeatAt),

  //     //   lastHeartbeatAt: machine.lastHeartbeatAt,

  //     //   lastStartupAt: machine.lastStartupAt,

  //     //   lastReceiptCapturedAt: machine.lastTransactionAt,

  //     //   ipAddress: machine.ipAddress,

  //     //   deviceName: machine.deviceName,

  //     //   osName: machine.osName,

  //     //   osVersion: machine.osVersion,

  //     //   createdAt: machine.createdAt,

  //     //   updatedAt: machine.updatedAt,
  //     // };

  //     return {
  //       machineId: machine.id,

  //       machineCode: machine.machineCode,

  //       machineName: machine.machineName,

  //       agent: {
  //         agentId: machine.agent?.agentId ?? null,
  //         agentName: machine.agent?.name ?? null,
  //       },

  //       status: {
  //         machineStatus: machine.status,

  //         connectionStatus: getMachineStatus(machine.lastHeartbeatAt),

  //         lastHeartbeatAt: machine.lastHeartbeatAt,

  //         lastStartupAt: machine.lastStartupAt,
  //       },

  //       runtime: {
  //         isSessionActive: Boolean(activeSession),

  //         sessionId: activeSession?.machineSessionId ?? null,

  //         startedAt: activeSession?.startedAt ?? null,

  //         onlineHours,
  //       },

  //       float: {
  //         openingFloat: machine.agent?.agentFloat?.openingFloat ?? 0,

  //         currentCashInHand: machine.agent?.agentFloat?.currentCashInHand ?? 0,

  //         currentCashInAccount:
  //           machine.agent?.agentFloat?.currentCashInAccount ?? 0,

  //         currentTotalFloat: machine.agent?.agentFloat?.currentTotalFloat ?? 0,

  //         lastReceiptAt: machine.agent?.agentFloat?.lastReceiptAt ?? null,

  //         updatedAt: machine.agent?.agentFloat?.updatedAt ?? null,
  //       },

  //       watcher: {
  //         version: machine.watcherVersion,
  //         enabled: machine.watcherEnabled,
  //       },

  //       device: {
  //         fingerprint: machine.fingerprint,

  //         deviceName: machine.deviceName,

  //         ipAddress: machine.ipAddress,

  //         osName: machine.osName,

  //         osVersion: machine.osVersion,
  //       },

  //       activity: {
  //         lastReceiptCapturedAt: machine.lastTransactionAt,
  //       },

  //       children,

  //       createdAt: machine.createdAt,

  //       updatedAt: machine.updatedAt,
  //     };
  //   });
  // }

  async getMachine(
    machineId: string,
    user: CurrentUser,
    filter: MachineDetailFilter,
  ) {
    return withTransaction(async (tx) => {
      // ============================================================
      // 1. Subscription validation
      // ============================================================

      const resolver = new SubscriptionResolver(tx);

      const subscription = await resolver.getEffectiveSubscription(
        user.agentId,
      );

      SubscriptionAccessValidator.validate(subscription);

      // Float figures are null for CSP plans without CASH_MANAGEMENT.
      const canViewFloat = await new SubscriptionEntitlementService(
        tx,
      ).canViewCashManagement(subscription);

      // ============================================================
      // 2. Date range
      //
      // Default:
      //   today 00:00:00 -> today 23:59:59
      //
      // With filter:
      //   from -> to
      // ============================================================

      const { from, to } = normalizeDateRange(filter.from, filter.to);

      // ============================================================
      // 3. Validate machine access
      // ============================================================

      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(user);

      const repository = new MachineListRepository(tx);

      const machine = await repository.getMachine(machineId, agentIds);

      if (!machine) {
        throw new NotFoundError("Machine not found.");
      }

      // ============================================================
      // 4. Determine CSP root
      //
      // If machine belongs to:
      //
      // CSP1001
      //     -> parentAgent = CSP1001
      //
      // KO1001
      //     -> parentAgent = CSP1001
      // ============================================================

      const parentAgent =
        machine.agent?.type === "KO"
          ? machine.agent.parentAgentId
          : machine.agent?.agentId;

      if (!parentAgent) {
        throw new NotFoundError("Parent Agent not found.");
      }

      // ============================================================
      // 5. Fetch CSP + all KOs
      //
      // This is the reporting unit:
      //
      // CSP1001
      // ├── CSP1001
      // ├── KO1001
      // └── KO1002
      // ============================================================

      const scopedAgents = await tx.agent.findMany({
        where: {
          isDeleted: false,

          OR: [
            {
              agentId: parentAgent,
            },
            {
              parentAgentId: parentAgent,
              type: "KO",
            },
          ],
        },

        select: {
          id: true,
          agentId: true,
          name: true,
          type: true,
          mobile: true,
          email: true,
          address: true,
          bcId: true,
          parentAgentId: true,
          linkedAt: true,
          createdAt: true,
          updatedAt: true,
        },

        orderBy: {
          type: "asc",
        },
      });

      const scopedAgentIds = scopedAgents
        .map((agent) => agent.agentId)
        .filter((id): id is string => Boolean(id));

      // ============================================================
      // 6. Fetch machines belonging to CSP + KOs
      // ============================================================

      const childMachines =
        scopedAgentIds.length === 0
          ? []
          : await tx.machine.findMany({
              where: {
                agentId: {
                  in: scopedAgentIds,
                },

                isDeleted: false,
              },

              select: {
                id: true,
                agentId: true,

                machineCode: true,
                machineName: true,

                status: true,

                lastHeartbeatAt: true,
                lastStartupAt: true,
                lastTransactionAt: true,

                watcherVersion: true,
                watcherEnabled: true,

                fingerprint: true,
                deviceName: true,
                ipAddress: true,

                osName: true,
                osVersion: true,
              },

              orderBy: {
                updatedAt: "desc",
              },
            });

      // ============================================================
      // 7. Map machine by agent
      //
      // Latest machine is used when an agent has multiple machines.
      // ============================================================

      const machineByAgentId = new Map<
        string,
        (typeof childMachines)[number]
      >();

      for (const childMachine of childMachines) {
        if (!childMachine.agentId) {
          continue;
        }
        if (!machineByAgentId.has(childMachine.agentId)) {
          machineByAgentId.set(childMachine.agentId, childMachine);
        }
      }

      // ============================================================
      // 8. Transaction summary for CSP + KOs
      // ============================================================

      const childTransactionRows =
        scopedAgentIds.length === 0
          ? []
          : await tx.receipt.groupBy({
              by: ["agentId", "status"],

              where: {
                agentId: {
                  in: scopedAgentIds,
                },

                transactionAt: {
                  gte: from,
                  lte: to,
                },
              },

              _count: {
                id: true,
              },

              _sum: {
                amount: true,
              },
            });

      const childTransactionMap = new Map<
        string,
        {
          count: number;
          amount: number;
          success: number;
          failed: number;
        }
      >();

      for (const row of childTransactionRows) {
        const existing = childTransactionMap.get(row.agentId) ?? {
          count: 0,
          amount: 0,
          success: 0,
          failed: 0,
        };

        const count = row._count.id;

        const amount = Number(row._sum.amount ?? 0);

        existing.count += count;
        existing.amount += amount;

        if (row.status === "SUCCESS") {
          existing.success += count;
        } else if (row.status === "FAILED") {
          existing.failed += count;
        }

        childTransactionMap.set(row.agentId, existing);
      }

      // ============================================================
      // Top-level transaction overview
      //
      // Represents:
      // CSP + all KOs
      // ============================================================

      let totalTransactions = 0;
      let successfulTransactions = 0;
      let failedTransactions = 0;
      let totalTransactionAmount = 0;

      for (const row of childTransactionRows) {
        const count = row._count.id;

        const amount = Number(row._sum.amount ?? 0);

        totalTransactions += count;

        if (row.status === "SUCCESS") {
          successfulTransactions += count;
          totalTransactionAmount += amount;
        } else if (row.status === "FAILED") {
          failedTransactions += count;
        }
      }

      const lastTransaction =
        scopedAgentIds.length === 0
          ? null
          : await tx.receipt.findFirst({
              where: {
                agentId: {
                  in: scopedAgentIds,
                },

                transactionAt: {
                  gte: from,
                  lte: to,
                },
              },

              orderBy: {
                transactionAt: "desc",
              },

              select: {
                transactionAt: true,
              },
            });

      const successRate =
        totalTransactions === 0
          ? 0
          : Number(
              ((successfulTransactions / totalTransactions) * 100).toFixed(2),
            );

      const failureRate =
        totalTransactions === 0
          ? 0
          : Number(((failedTransactions / totalTransactions) * 100).toFixed(2));

      // ============================================================
      // 9. Service summary for CSP + KOs
      // ============================================================

      const childServiceRows =
        scopedAgentIds.length === 0
          ? []
          : await tx.receipt.groupBy({
              by: ["agentId", "transactionCategory", "receiptType", "status"],

              where: {
                agentId: {
                  in: scopedAgentIds,
                },

                transactionAt: {
                  gte: from,
                  lte: to,
                },
              },

              _count: {
                id: true,
              },

              _sum: {
                amount: true,
              },

              orderBy: {
                transactionCategory: "asc",
              },
            });

      const childServiceMap = new Map<
        string,
        Array<{
          transactionCategory: string;
          receiptType: string;
          successCount: number;
          failedCount: number;
          successAmount: number;
          failedAmount: number;
        }>
      >();

      for (const row of childServiceRows) {
        const services = childServiceMap.get(row.agentId) ?? [];

        let service = services.find(
          (item) =>
            item.transactionCategory === row.transactionCategory &&
            item.receiptType === row.receiptType,
        );

        if (!service) {
          service = {
            transactionCategory: row.transactionCategory,

            receiptType: row.receiptType,

            successCount: 0,
            failedCount: 0,

            successAmount: 0,
            failedAmount: 0,
          };

          services.push(service);
        }

        const count = row._count.id;

        const amount = Number(row._sum.amount ?? 0);

        if (row.status === "SUCCESS") {
          service.successCount += count;

          service.successAmount += amount;
        } else if (row.status === "FAILED") {
          service.failedCount += count;

          service.failedAmount += amount;
        }

        childServiceMap.set(row.agentId, services);
      }

      // ============================================================
      // Top-level services
      //
      // Aggregate CSP + all KOs together.
      // ============================================================

      const topLevelServiceMap = new Map<
        string,
        {
          transactionCategory: string;
          receiptType: string;

          successCount: number;
          failedCount: number;

          successAmount: number;
          failedAmount: number;
        }
      >();

      for (const row of childServiceRows) {
        const key = `${row.transactionCategory}:${row.receiptType}`;

        const existing = topLevelServiceMap.get(key) ?? {
          transactionCategory: row.transactionCategory,

          receiptType: row.receiptType,

          successCount: 0,
          failedCount: 0,

          successAmount: 0,
          failedAmount: 0,
        };

        const count = row._count.id;

        const amount = Number(row._sum.amount ?? 0);

        if (row.status === "SUCCESS") {
          existing.successCount += count;
          existing.successAmount += amount;
        } else if (row.status === "FAILED") {
          existing.failedCount += count;
          existing.failedAmount += amount;
        }

        topLevelServiceMap.set(key, existing);
      }

      const services = Array.from(topLevelServiceMap.values());

      const statusSummary = {
        success: successfulTransactions,

        failed: failedTransactions,

        total: totalTransactions,
      };

      const recentTransactions =
        scopedAgentIds.length === 0
          ? []
          : await tx.receipt.findMany({
              where: {
                agentId: {
                  in: scopedAgentIds,
                },

                transactionAt: {
                  gte: from,
                  lte: to,
                },
              },

              orderBy: {
                transactionAt: "desc",
              },

              take: 5,

              select: {
                receiptId: true,

                receiptType: true,

                transactionCategory: true,

                status: true,

                amount: true,

                transactionAt: true,

                customerName: true,

                customerAccount: true,

                rrn: true,

                stan: true,
              },
            });

      // ============================================================
      // 10. Build children
      //
      // Each child gets:
      // - agent details
      // - individual machine status
      // - individual machine details
      // - individual transactions
      // - individual services
      // ============================================================

      const children = scopedAgents.map((agent) => {
        const transaction = childTransactionMap.get(agent.agentId) ?? {
          count: 0,
          amount: 0,
          success: 0,
          failed: 0,
        };

        const agentMachine = machineByAgentId.get(agent.agentId);

        return {
          id: agent.id,

          agentId: agent.agentId,

          name: agent.name,

          type: agent.type,

          mobile: agent.mobile,

          email: agent.email,

          address: agent.address,

          bcId: agent.bcId,

          parentAgentId: agent.parentAgentId,

          linkedAt: agent.linkedAt,

          createdAt: agent.createdAt,

          updatedAt: agent.updatedAt,

          status: {
            machineStatus: agentMachine?.status ?? null,

            connectionStatus: agentMachine
              ? getMachineStatus(agentMachine.lastHeartbeatAt)
              : null,

            lastHeartbeatAt: agentMachine?.lastHeartbeatAt ?? null,

            lastStartupAt: agentMachine?.lastStartupAt ?? null,
          },

          machine: agentMachine
            ? {
                machineId: agentMachine.id,

                machineCode: agentMachine.machineCode,

                machineName: agentMachine.machineName,

                watcher: {
                  version: agentMachine.watcherVersion,

                  enabled: agentMachine.watcherEnabled,
                },

                device: {
                  fingerprint: agentMachine.fingerprint,

                  deviceName: agentMachine.deviceName,

                  ipAddress: agentMachine.ipAddress,

                  osName: agentMachine.osName,

                  osVersion: agentMachine.osVersion,
                },

                lastReceiptCapturedAt: agentMachine.lastTransactionAt,
              }
            : null,

          transaction: {
            count: transaction.count,

            amount: transaction.amount,

            success: transaction.success,

            failed: transaction.failed,
          },

          services: childServiceMap.get(agent.agentId) ?? [],
        };
      });

      // ============================================================
      // 11. Determine CSP + KO unit status
      //
      // Top-level status represents the entire CSP unit.
      //
      // If ANY CSP/KO machine is:
      //   ACTIVE -> unit ACTIVE
      //
      // If ANY CSP/KO machine is:
      //   ONLINE -> unit ONLINE
      //
      // Prefer an ONLINE + ACTIVE machine when
      // returning heartbeat/startup information.
      // ============================================================

      const unitMachines = scopedAgents
        .map((agent) => machineByAgentId.get(agent.agentId))
        .filter(
          (childMachine): childMachine is NonNullable<typeof childMachine> =>
            Boolean(childMachine),
        );

      const unitIsActive = unitMachines.some(
        (childMachine) => childMachine.status === "ACTIVE",
      );

      const unitIsOnline = unitMachines.some(
        (childMachine) =>
          getMachineStatus(childMachine.lastHeartbeatAt) === "ONLINE",
      );

      const preferredUnitMachine =
        unitMachines.find(
          (childMachine) =>
            childMachine.status === "ACTIVE" &&
            getMachineStatus(childMachine.lastHeartbeatAt) === "ONLINE",
        ) ??
        unitMachines.find((childMachine) => childMachine.status === "ACTIVE") ??
        unitMachines.find(
          (childMachine) =>
            getMachineStatus(childMachine.lastHeartbeatAt) === "ONLINE",
        ) ??
        unitMachines[0];

      // ============================================================
      // 12. Runtime
      //
      // IMPORTANT:
      // Runtime remains for the machine requested
      // in /machines/:machineId.
      //
      // It is NOT CSP + KO aggregated runtime.
      // ============================================================

      const sessionRepository = new MachineSessionRepository(tx);

      const activeSession = await sessionRepository.findActiveSession(
        machine.id,
      );

      const sessions = await sessionRepository.findSessionsForRange(
        machine.id,
        from,
        to,
      );

      const onlineHours = this.calculateRuntimeHours(sessions, from, to);

      // ============================================================
      // 13. Final response
      // ============================================================

      return {
        machineId: machine.id,

        machineCode: machine.machineCode,

        machineName: machine.machineName,

        // ----------------------------------------------------------
        // CSP identity only
        // ----------------------------------------------------------

        agent: {
          agentId: parentAgent,

          agentName:
            scopedAgents.find((agent) => agent.agentId === parentAgent)?.name ??
            machine.agent?.name ??
            null,
        },

        // ----------------------------------------------------------
        // CSP + KO unit status
        // ----------------------------------------------------------

        status: {
          machineStatus: unitIsActive ? "ACTIVE" : "INACTIVE",

          connectionStatus: unitIsOnline ? "ONLINE" : "OFFLINE",

          lastHeartbeatAt: preferredUnitMachine?.lastHeartbeatAt ?? null,

          lastStartupAt: preferredUnitMachine?.lastStartupAt ?? null,
        },

        // ----------------------------------------------------------
        // Requested machine runtime
        // ----------------------------------------------------------

        runtime: {
          isSessionActive: Boolean(activeSession),

          sessionId: activeSession?.machineSessionId ?? null,

          startedAt: activeSession?.startedAt ?? null,

          onlineHours,
        },

        // ----------------------------------------------------------
        // CSP float
        // ----------------------------------------------------------

        float: canViewFloat
          ? {
              openingFloat: machine.agent?.agentFloat?.openingFloat ?? 0,

              currentCashInHand:
                machine.agent?.agentFloat?.currentCashInHand ?? 0,

              currentCashInAccount:
                machine.agent?.agentFloat?.currentCashInAccount ?? 0,

              currentTotalFloat:
                machine.agent?.agentFloat?.currentTotalFloat ?? 0,

              lastReceiptAt: machine.agent?.agentFloat?.lastReceiptAt ?? null,

              updatedAt: machine.agent?.agentFloat?.updatedAt ?? null,
            }
          : null,

        // ----------------------------------------------------------
        // Requested machine watcher
        // ----------------------------------------------------------

        watcher: {
          version: machine.watcherVersion,

          enabled: machine.watcherEnabled,
        },

        // ----------------------------------------------------------
        // Requested machine device
        // ----------------------------------------------------------

        device: {
          fingerprint: machine.fingerprint,

          deviceName: machine.deviceName,

          ipAddress: machine.ipAddress,

          osName: machine.osName,

          osVersion: machine.osVersion,
        },

        // ----------------------------------------------------------
        // Requested machine activity
        // ----------------------------------------------------------

        activity: {
          lastReceiptCapturedAt: machine.lastTransactionAt,
        },

        // ----------------------------------------------------------
        // Overview Transaction activity
        // ----------------------------------------------------------

        overview: {
          totalTransactions,

          successfulTransactions,

          failedTransactions,

          totalTransactionAmount,

          lastTransactionAt: lastTransaction?.transactionAt ?? null,

          successRate,

          failureRate,
        },

        services,

        statusSummary,

        recentTransactions: recentTransactions.map((transaction) => ({
          receiptId: transaction.receiptId,

          receiptType: transaction.receiptType,

          transactionCategory: transaction.transactionCategory,

          status: transaction.status,

          amount: transaction.amount,

          transactionAt: transaction.transactionAt,

          customerName: transaction.customerName,

          customerAccount: transaction.customerAccount,

          rrn: transaction.rrn,

          stan: transaction.stan,
        })),

        // ----------------------------------------------------------
        // CSP + KOs
        // ----------------------------------------------------------

        children,

        createdAt: machine.createdAt,

        updatedAt: machine.updatedAt,
      };
    });
  }

  async updateMachine(
    machineId: string,
    data: {
      machineName?: string;
      watcherEnabled?: boolean;
    },
    user: CurrentUser,
  ) {
    return withTransaction(async (tx) => {
      // check for subscription and access validation
      const resolver = new SubscriptionResolver(tx);

      const subscription = await resolver.getEffectiveSubscription(
        user.agentId,
      );

      SubscriptionAccessValidator.validate(subscription);

      // continue with the transaction and fetch machines
      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(user);

      const repository = new MachineListRepository(tx);

      const machine = await repository.updateMachine(machineId, data, agentIds);

      if (!machine) {
        throw new NotFoundError("Machine not found.");
      }

      return machine;
    });
  }

  async getHeartbeat(machineId: string, user: CurrentUser) {
    return withTransaction(async (tx) => {
      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(user);

      const repository = new MachineListRepository(tx);

      const machine = await repository.getHeartbeat(machineId, agentIds);

      if (!machine) {
        throw new NotFoundError("Machine not found.");
      }

      const activation = machine.activations[0];

      return {
        machineId: machine.id,

        machineCode: machine.machineCode,

        watcherVersion: machine.watcherVersion,

        watcherEnabled: machine.watcherEnabled,

        connectionStatus: getMachineStatus(machine.lastHeartbeatAt),

        lastHeartbeatAt: machine.lastHeartbeatAt,

        lastStartupAt: machine.lastStartupAt,

        lastReceiptCapturedAt: machine.lastTransactionAt,

        heartbeatInterval: 60,

        latestWatcherVersion: "1.0.0",

        receiptUploadEnabled: true,

        subscriptionStatus: activation?.subscription.status ?? null,
      };
    });
  }

  private calculateRuntimeHours(
    sessions: Array<{
      startedAt: Date;
      endedAt: Date | null;
    }>,
    from: Date,
    to: Date,
  ) {
    let totalSeconds = 0;

    for (const session of sessions) {
      const sessionStart = Math.max(
        session.startedAt.getTime(),
        from.getTime(),
      );

      const sessionEnd = Math.min(
        (session.endedAt ?? new Date()).getTime(),
        to.getTime(),
      );

      if (sessionEnd <= sessionStart) {
        continue;
      }

      totalSeconds += (sessionEnd - sessionStart) / 1000;
    }

    return Number((totalSeconds / 3600).toFixed(2));
  }
}
