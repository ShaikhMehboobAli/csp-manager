import { withTransaction } from "../../../core/database/transaction";
import { NotFoundError } from "../../../core/errors/NotFoundError";
import { CurrentUser } from "../../../core/types/auth.types";

import AgentScopeService from "../../agents/service/agent-scope.service";
import { getMachineStatus } from "../../dashboard/dashboard.helper";

import MachineListRepository from "../repository/machine-list.repository";

export default class MachineListService {
  async getMachines(user: CurrentUser) {
    return withTransaction(async (tx) => {
      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(user);

      const repository = new MachineListRepository(tx);

      return repository.getMachines(agentIds);
    });
  }

  async getMachine(machineId: string, user: CurrentUser) {
    return withTransaction(async (tx) => {
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
}
