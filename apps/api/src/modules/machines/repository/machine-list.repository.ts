import { PrismaDb } from "../../../core/database/prisma.types";
import { buildAgentScope } from "../../dashboard/dashboard.helper";
import { getMachineStatus } from "../../dashboard/dashboard.helper";

export default class MachineListRepository {
  constructor(private readonly db: PrismaDb) {}

  async getMachines(agentIds: string[], agentId?: string) {
    const machines = await this.db.machine.findMany({
      where: {
        ...buildAgentScope(agentIds, agentId),

        isDeleted: false,
      },

      include: {
        agent: {
          select: {
            agentId: true,

            name: true,
          },
        },
      },

      orderBy: {
        updatedAt: "desc",
      },
    });

    return machines.map((machine) => ({
      machineId: machine.id,

      machineCode: machine.machineCode,

      machineName: machine.machineName,

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
    }));
  }

  async getMachine(machineId: string, agentIds: string[], agentId?: string) {
    return this.db.machine.findFirst({
      where: {
        id: machineId,

        ...buildAgentScope(agentIds, agentId),

        isDeleted: false,
      },

      include: {
        agent: {
          select: {
            agentId: true,

            name: true,
          },
        },
      },
    });
  }

  async updateMachine(
    machineId: string,
    data: {
      machineName?: string;
      watcherEnabled?: boolean;
    },
    agentIds: string[],
    agentId?: string,
  ) {
    const machine = await this.db.machine.findFirst({
      where: {
        id: machineId,

        ...buildAgentScope(agentIds, agentId),

        isDeleted: false,
      },
    });

    if (!machine) {
      return null;
    }

    return this.db.machine.update({
      where: {
        id: machineId,
      },

      data,
    });
  }

  async getHeartbeat(machineId: string, agentIds: string[], agentId?: string) {
    return this.db.machine.findFirst({
      where: {
        id: machineId,

        ...buildAgentScope(agentIds, agentId),

        isDeleted: false,
      },

      include: {
        activations: {
          where: {
            isCurrent: true,
          },

          include: {
            subscription: true,
          },

          take: 1,
        },
      },
    });
  }
}
