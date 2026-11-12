import { getMachineStatus } from "../dashboard/dashboard.helper";
import {
  MachineSummary,
  ServiceSummary,
  TransactionSummary,
} from "./types/machine.types";

export function buildTransactionMap(
  transactionSummary: Array<{
    agentId: string;
    status: string | null;
    _count: {
      id: number;
    };
    _sum: {
      amount: unknown;
    };
  }>,
) {
  const transactionMap = new Map<string, TransactionSummary>();

  for (const row of transactionSummary) {
    const existing = transactionMap.get(row.agentId) ?? {
      count: 0,
      amount: 0,
      success: 0,
      failed: 0,
    };

    existing.count += row._count.id;

    existing.amount += Number(row._sum.amount ?? 0);

    if (row.status === "SUCCESS") {
      existing.success += row._count.id;
    } else if (row.status === "FAILED") {
      existing.failed += row._count.id;
    }

    transactionMap.set(row.agentId, existing);
  }

  return transactionMap;
}

export function buildServiceMap(
  serviceSummary: Array<{
    agentId: string;
    transactionCategory: string;
    _count: {
      id: number;
    };
  }>,
) {
  const serviceMap = new Map<string, ServiceSummary[]>();

  for (const row of serviceSummary) {
    const services = serviceMap.get(row.agentId) ?? [];

    services.push({
      transactionCategory: row.transactionCategory,
      count: row._count.id,
    });

    serviceMap.set(row.agentId, services);
  }

  return serviceMap;
}

export function buildMachineMap(
  machines: Array<{
    id: string;
    agentId: string | null;
    machineCode: string;
    machineName: string | null;
    status: string;
    lastHeartbeatAt: Date | null;
    lastStartupAt: Date | null;
    lastTransactionAt: Date | null;
  }>,
) {
  const machineMap = new Map<string, MachineSummary>();

  for (const machine of machines) {
    if (!machine.agentId) {
      continue;
    }

    machineMap.set(machine.agentId, {
      machineId: machine.id,

      machineCode: machine.machineCode,

      machineName: machine.machineName,

      machineStatus: machine.status,

      connectionStatus: getMachineStatus(machine.lastHeartbeatAt),

      lastHeartbeatAt: machine.lastHeartbeatAt,

      lastStartupAt: machine.lastStartupAt,

      lastReceiptCapturedAt: machine.lastTransactionAt,
    });
  }

  return machineMap;
}
