import {
  ChildAgentOverview,
  FloatSummary,
  MachineOverview,
  ServiceSummary,
  TransactionSummary,
} from "./types/machine.types";

import { getMachineStatus } from "../dashboard/dashboard.helper";

export function mapMachineList(
  machines: any[],
  transactionMap: Map<string, TransactionSummary>,
  serviceMap: Map<string, ServiceSummary[]>,
  machineMap: Map<
    string,
    {
      lastHeartbeatAt: Date | null;
      lastReceiptCapturedAt: Date | null;
    }
  >,
): MachineOverview[] {
  return machines.map((machine) =>
    mapMachine(machine, transactionMap, serviceMap, machineMap),
  );
}

export function mapMachine(
  machine: any,
  transactionMap: Map<string, TransactionSummary>,
  serviceMap: Map<string, ServiceSummary[]>,
  machineMap: Map<
    string,
    {
      lastHeartbeatAt: Date | null;
      lastReceiptCapturedAt: Date | null;
    }
  >,
): MachineOverview {
  return {
    machine: {
      machineId: machine.id,

      machineCode: machine.machineCode,

      machineName: machine.machineName,

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
    },

    agent: {
      agentId: machine.agent.agentId,

      name: machine.agent.name,

      type: machine.agent.type,
    },

    float: mapFloat(machine.agent.agentFloat),

    transaction:
      transactionMap.get(machine.agent.agentId) ?? emptyTransaction(),

    services: serviceMap.get(machine.agent.agentId) ?? [],

    children:
      machine.agent.childAgents?.map((ko: any) =>
        mapChildAgent(ko, transactionMap, serviceMap, machineMap),
      ) ?? [],
  };
}

function mapFloat(float: any): FloatSummary | null {
  if (!float) {
    return null;
  }

  return {
    openingFloat: Number(float.openingFloat),

    currentCashInHand: Number(float.currentCashInHand),

    currentCashInAccount: Number(float.currentCashInAccount),

    currentTotalFloat: Number(float.currentTotalFloat),

    lastReceiptAt: float.lastReceiptAt,

    lastReceiptUpdatedAt: float.updatedAt,
  };
}

function mapChildAgent(
  child: any,
  transactionMap: Map<string, TransactionSummary>,
  serviceMap: Map<string, ServiceSummary[]>,
  machineMap: Map<
    string,
    {
      lastHeartbeatAt: Date | null;
      lastReceiptCapturedAt: Date | null;
    }
  >,
): ChildAgentOverview {
  return {
    id: child.id,

    agentId: child.agentId,

    name: child.name,

    type: child.type,

    mobile: child.mobile,

    email: child.email,

    address: child.address,

    bcId: child.bcId,

    parentAgentId: child.parentAgentId,

    linkedAt: child.linkedAt,

    createdAt: child.createdAt,

    updatedAt: child.updatedAt,

    machine: machineMap.get(child.agentId) ?? {
      lastHeartbeatAt: null,

      lastReceiptCapturedAt: null,
    },

    transaction: transactionMap.get(child.agentId) ?? emptyTransaction(),

    services: serviceMap.get(child.agentId) ?? [],
  };
}

function emptyTransaction(): TransactionSummary {
  return {
    count: 0,

    amount: 0,

    success: 0,

    failed: 0,
  };
}
