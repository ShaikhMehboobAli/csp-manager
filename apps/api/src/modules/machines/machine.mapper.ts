import {
  ChildAgentOverview,
  FloatSummary,
  MachineOverview,
  MachineSummary,
  ServiceSummary,
  TransactionSummary,
} from "./types/machine.types";

import { getMachineStatus } from "../dashboard/dashboard.helper";

// export function mapMachineList(
//   machines: any[],
//   transactionMap: Map<string, TransactionSummary>,
//   serviceMap: Map<string, ServiceSummary[]>,
//   machineMap: Map<
//     string,
//     {
//       lastHeartbeatAt: Date | null;
//       lastReceiptCapturedAt: Date | null;
//     }
//   >,
// ): MachineOverview[] {
//   return machines.map((machine) =>
//     mapMachine(machine, transactionMap, serviceMap, machineMap),
//   );
// }

export function mapMachineList(
  machines: any[],
  transactionMap: Map<string, TransactionSummary>,
  serviceMap: Map<string, ServiceSummary[]>,
  machineMap: Map<string, MachineSummary>,
): MachineOverview[] {
  return machines.map((machine) =>
    mapMachine(machine, transactionMap, serviceMap, machineMap),
  );
}

// export function mapMachine(
//   machine: any,
//   transactionMap: Map<string, TransactionSummary>,
//   serviceMap: Map<string, ServiceSummary[]>,
//   machineMap: Map<
//     string,
//     {
//       lastHeartbeatAt: Date | null;
//       lastReceiptCapturedAt: Date | null;
//     }
//   >,
// ): MachineOverview {
//   return {
//     machine: {
//       machineId: machine.id,

//       machineCode: machine.machineCode,

//       machineName: machine.machineName,

//       watcherVersion: machine.watcherVersion,

//       watcherEnabled: machine.watcherEnabled,

//       machineStatus: machine.status,

//       connectionStatus: getMachineStatus(machine.lastHeartbeatAt),

//       lastHeartbeatAt: machine.lastHeartbeatAt,

//       lastStartupAt: machine.lastStartupAt,

//       lastReceiptCapturedAt: machine.lastTransactionAt,

//       ipAddress: machine.ipAddress,

//       deviceName: machine.deviceName,

//       osName: machine.osName,

//       osVersion: machine.osVersion,
//     },

//     agent: {
//       agentId: machine.agent.agentId,

//       name: machine.agent.name,

//       type: machine.agent.type,
//     },

//     float: mapFloat(machine.agent.agentFloat),

//     transaction:
//       transactionMap.get(machine.agent.agentId) ?? emptyTransaction(),

//     services: serviceMap.get(machine.agent.agentId) ?? [],

//     children:
//       machine.agent.childAgents?.map((ko: any) =>
//         mapChildAgent(ko, transactionMap, serviceMap, machineMap),
//       ) ?? [],
//   };
// }

export function mapMachine(
  machine: any,
  transactionMap: Map<string, TransactionSummary>,
  serviceMap: Map<string, ServiceSummary[]>,
  machineMap: Map<string, MachineSummary>,
): MachineOverview {
  const cspAgentId = machine.agent.agentId;

  const childAgents = machine.agent.childAgents ?? [];

  /*
   * Top-level machine represents the CSP unit.
   *
   * Therefore:
   * transaction = CSP + all KOs
   * services    = CSP + all KOs
   */
  const unitAgentIds = [
    cspAgentId,
    ...childAgents
      .map((child: any) => child.agentId)
      .filter((id: string | null): id is string => Boolean(id)),
  ];

  const transaction = aggregateTransactions(unitAgentIds, transactionMap);

  //   const services = aggregateServices(unitAgentIds, serviceMap);

  const services = aggregateServices(
    unitAgentIds.flatMap((agentId) => serviceMap.get(agentId) ?? []),
  );

  /*
   * Children contain individual agent details.
   *
   * We intentionally include the CSP itself first,
   * followed by all KOs.
   */
  const children: ChildAgentOverview[] = [
    mapCspAsChild(machine, transactionMap, serviceMap, machineMap),

    ...childAgents.map((ko: any) =>
      mapChildAgent(ko, transactionMap, serviceMap, machineMap),
    ),
  ];

  const unitMachineStatus = getUnitMachineStatus(
    machine,
    machine.agent.childAgents ?? [],
    machineMap,
  );

  return {
    machine: {
      machineId: machine.id,

      machineCode: machine.machineCode,

      machineName: machine.machineName,

      watcherVersion: machine.watcherVersion,

      watcherEnabled: machine.watcherEnabled,

      machineStatus: unitMachineStatus.machineStatus,

      connectionStatus: unitMachineStatus.connectionStatus,

      lastHeartbeatAt: unitMachineStatus.lastHeartbeatAt,

      lastStartupAt: unitMachineStatus.lastStartupAt,

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

    /*
     * KEEP FLOAT.
     *
     * This belongs to the CSP/unit and should NOT be
     * removed while aggregating transactions.
     */
    float: mapFloat(machine.agent.agentFloat),

    /*
     * CSP + all KOs
     */
    transaction,

    /*
     * CSP + all KOs
     */
    services,

    children,
  };
}

function aggregateTransactions(
  agentIds: string[],
  transactionMap: Map<string, TransactionSummary>,
): TransactionSummary {
  const result = emptyTransaction();

  for (const agentId of agentIds) {
    const transaction = transactionMap.get(agentId);

    if (!transaction) {
      continue;
    }

    result.count += transaction.count;
    result.amount += transaction.amount;
    result.success += transaction.success;
    result.failed += transaction.failed;
  }

  return result;
}

function getUnitMachineStatus(
  machine: any,
  childAgents: any[],
  machineMap: Map<string, MachineSummary>,
) {
  const machines: MachineSummary[] = [];

  // CSP machine
  machines.push({
    machineId: machine.id,

    machineCode: machine.machineCode,

    machineName: machine.machineName,

    machineStatus: machine.status,

    connectionStatus: getMachineStatus(machine.lastHeartbeatAt),

    lastHeartbeatAt: machine.lastHeartbeatAt,

    lastStartupAt: machine.lastStartupAt,

    lastReceiptCapturedAt: machine.lastTransactionAt,
  });

  // KO machines
  for (const child of childAgents) {
    const childMachine = machineMap.get(child.agentId);

    if (childMachine) {
      machines.push(childMachine);
    }
  }

  /*
   * ONLINE has highest priority.
   */
  const onlineMachine = machines.find(
    (item) => item.connectionStatus === "ONLINE",
  );

  if (onlineMachine) {
    return {
      machineStatus: onlineMachine.machineStatus,

      connectionStatus: "ONLINE",

      lastHeartbeatAt: onlineMachine.lastHeartbeatAt,

      lastStartupAt: onlineMachine.lastStartupAt,
    };
  }

  /*
   * No machine is online.
   *
   * Use the most recently active/known machine
   * for the top-level status.
   */
  const latestMachine = [...machines].sort((a, b) => {
    const aTime = a.lastHeartbeatAt?.getTime() ?? 0;

    const bTime = b.lastHeartbeatAt?.getTime() ?? 0;

    return bTime - aTime;
  })[0];

  if (!latestMachine) {
    return {
      machineStatus: machine.status,

      connectionStatus: getMachineStatus(machine.lastHeartbeatAt),

      lastHeartbeatAt: machine.lastHeartbeatAt,

      lastStartupAt: machine.lastStartupAt,
    };
  }

  return {
    machineStatus: latestMachine.machineStatus,

    connectionStatus: latestMachine.connectionStatus,

    lastHeartbeatAt: latestMachine.lastHeartbeatAt,

    lastStartupAt: latestMachine.lastStartupAt,
  };
}

function aggregateServices(services: ServiceSummary[]): ServiceSummary[] {
  const serviceMap = new Map<string, ServiceSummary>();

  for (const service of services) {
    const existing = serviceMap.get(service.transactionCategory);

    if (existing) {
      existing.count += service.count;
    } else {
      serviceMap.set(service.transactionCategory, {
        transactionCategory: service.transactionCategory,
        count: service.count,
      });
    }
  }

  return Array.from(serviceMap.values());
}

function mapCspAsChild(
  machine: any,
  transactionMap: Map<string, TransactionSummary>,
  serviceMap: Map<string, ServiceSummary[]>,
  machineMap: Map<string, MachineSummary>,
): ChildAgentOverview {
  const agent = machine.agent;

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

    /*
     * CSP machine is the machine currently represented
     * by the top-level item.
     */
    machine: {
      machineId: machine.id,
      machineCode: machine.machineCode,
      machineName: machine.machineName,

      machineStatus: machine.status,

      connectionStatus: getMachineStatus(machine.lastHeartbeatAt),

      lastHeartbeatAt: machine.lastHeartbeatAt ?? null,

      lastStartupAt: machine.lastStartupAt ?? null,

      lastReceiptCapturedAt: machine.lastTransactionAt ?? null,
    },

    transaction: transactionMap.get(agent.agentId) ?? emptyTransaction(),

    services: serviceMap.get(agent.agentId) ?? [],
  };
}

function mapFloat(float: any): FloatSummary | null {
  // No float row yet: zeros, like dashboard and machine detail. A null
  // float means "hidden by plan" (no CASH_MANAGEMENT).
  if (!float) {
    return {
      openingFloat: 0,
      currentCashInHand: 0,
      currentCashInAccount: 0,
      currentTotalFloat: 0,
      lastReceiptAt: null,
      lastReceiptUpdatedAt: null,
    };
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

// function mapChildAgent(
//   child: any,
//   transactionMap: Map<string, TransactionSummary>,
//   serviceMap: Map<string, ServiceSummary[]>,
//   machineMap: Map<
//     string,
//     {
//       lastHeartbeatAt: Date | null;
//       lastReceiptCapturedAt: Date | null;
//     }
//   >,
// ): ChildAgentOverview {
//   return {
//     id: child.id,

//     agentId: child.agentId,

//     name: child.name,

//     type: child.type,

//     mobile: child.mobile,

//     email: child.email,

//     address: child.address,

//     bcId: child.bcId,

//     parentAgentId: child.parentAgentId,

//     linkedAt: child.linkedAt,

//     createdAt: child.createdAt,

//     updatedAt: child.updatedAt,

//     machine: machineMap.get(child.agentId) ?? {
//       lastHeartbeatAt: null,

//       lastReceiptCapturedAt: null,
//     },

//     transaction: transactionMap.get(child.agentId) ?? emptyTransaction(),

//     services: serviceMap.get(child.agentId) ?? [],
//   };
// }

function mapChildAgent(
  child: any,
  transactionMap: Map<string, TransactionSummary>,
  serviceMap: Map<string, ServiceSummary[]>,
  machineMap: Map<string, MachineSummary>,
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

    machine: machineMap.get(child.agentId) ?? null,

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
