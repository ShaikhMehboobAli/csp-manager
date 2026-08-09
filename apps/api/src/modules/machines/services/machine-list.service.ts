import { withTransaction } from "../../../core/database/transaction";
import { NotFoundError } from "../../../core/errors/NotFoundError";
import { CurrentUser } from "../../../core/types/auth.types";

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

import MachineListRepository from "../repository/machine-list.repository";
import { MachineListFilter } from "../types/machine.types";

export default class MachineListService {
  // async getMachines(user: CurrentUser) {
  //   return withTransaction(async (tx) => {
  //     // check for subscription and access validation
  //     const resolver = new SubscriptionResolver(tx);

  //     const subscription = await resolver.getEffectiveSubscription(
  //       user.agentId,
  //     );

  //     SubscriptionAccessValidator.validate(subscription);

  //     // continue with the transaction and fetch machines
  //     const scopeService = new AgentScopeService(tx);

  //     const agentIds = await scopeService.getAgentScope(user);

  //     const repository = new MachineListRepository(tx);

  //     // return repository.getMachines(agentIds);
  //     const machines = await repository.getMachines(agentIds);

  //     const transactionSummary =
  //       await repository.getTodayTransactionSummary(agentIds);

  //     const serviceSummary = await repository.getTodayServiceSummary(agentIds);

  //     const transactionMap = new Map<
  //       string,
  //       {
  //         count: number;
  //         amount: number;
  //         success: number;
  //         failed: number;
  //       }
  //     >();

  //     for (const row of transactionSummary) {
  //       const existing = transactionMap.get(row.agentId) ?? {
  //         count: 0,
  //         amount: 0,
  //         success: 0,
  //         failed: 0,
  //       };

  //       existing.count += row._count.id;
  //       existing.amount += Number(row._sum.amount ?? 0);

  //       if (row.status === "SUCCESS") {
  //         existing.success += row._count.id;
  //       } else {
  //         existing.failed += row._count.id;
  //       }

  //       transactionMap.set(row.agentId, existing);
  //     }

  //     const serviceMap = new Map<string, Record<string, number>>();

  //     for (const row of serviceSummary) {
  //       const services = serviceMap.get(row.agentId) ?? {};

  //       services[row.transactionCategory] = row._count.id;

  //       serviceMap.set(row.agentId, services);
  //     }

  //     return machines.map((machine) => ({
  //       machine: {
  //         machineId: machine.id,

  //         machineCode: machine.machineCode,

  //         machineName: machine.machineName,

  //         watcherVersion: machine.watcherVersion,

  //         watcherEnabled: machine.watcherEnabled,

  //         machineStatus: machine.status,

  //         connectionStatus: getMachineStatus(machine.lastHeartbeatAt),

  //         lastHeartbeatAt: machine.lastHeartbeatAt,

  //         lastStartupAt: machine.lastStartupAt,

  //         lastReceiptCapturedAt: machine.lastTransactionAt,

  //         ipAddress: machine.ipAddress,

  //         deviceName: machine.deviceName,

  //         osName: machine.osName,

  //         osVersion: machine.osVersion,
  //       },

  //       agent: {
  //         agentId: machine.agent?.agentId,

  //         name: machine.agent?.name,

  //         type: machine.agent?.type,
  //       },

  //       float: machine.agent?.agentFloat ?? null,

  //       transaction: transactionMap.get(machine.agent!.agentId) ?? {
  //         count: 0,
  //         amount: 0,
  //         success: 0,
  //         failed: 0,
  //       },

  //       services: serviceMap.get(machine.agent!.agentId) ?? {},

  //       children: machine.agent?.childAgents ?? [],
  //     }));
  //   });
  // }

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

      return {
        items,

        pagination: machineResult.pagination,
      };

      // return {
      //   items: mapMachineList(
      //     machineResult.items,
      //     buildTransactionMap(transactionSummary),
      //     buildServiceMap(serviceSummary),
      //     buildMachineMap(machineSummary),
      //   ),

      //   pagination: machineResult.pagination,
      // };
    });
  }

  async getMachine(machineId: string, user: CurrentUser) {
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

      const machine = await repository.getMachine(machineId, agentIds);

      if (!machine) {
        throw new NotFoundError("Machine not found.");
      }

      return {
        machineId: machine.id,

        machineCode: machine.machineCode,

        machineName: machine.machineName,

        fingerprint: machine.fingerprint,

        agentId: machine.agent?.agentId,

        agentName: machine.agent?.name,

        watcherVersion: machine.watcherVersion,

        watcherEnabled: machine.watcherEnabled,

        machineStatus: machine.status,

        connectionStatus: getMachineStatus(machine.lastHeartbeatAt),

        lastHeartbeatAt: machine.lastHeartbeatAt,

        lastStartupAt: machine.lastStartupAt,

        lastReceiptCapturedAt: machine.lastTransactionAt,

        ipAddress: machine.ipAddress,

        deviceName: machine.deviceName,

        osName: machine.osName,

        osVersion: machine.osVersion,

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
}
