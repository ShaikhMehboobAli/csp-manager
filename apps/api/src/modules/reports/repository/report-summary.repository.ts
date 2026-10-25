import { PrismaDb } from "../../../core/database/prisma.types";

import ReportCommonRepository from "./report-common.repository";

import { ReportFilter } from "../report.dto";

import {
  AgentType,
  ReceiptStatus,
  TransactionCategory,
} from "../../../generated/prisma/enums";

export interface ReportSummaryRow {
  agentId: string;

  agentName: string;

  services: Record<
    TransactionCategory,
    {
      count: number;
      amount: number;
    }
  >;

  success: number;

  failed: number;

  total: number;

  // null when the viewer's plan has no CASH_MANAGEMENT.
  openingBalance: number | null;

  closingBalance: number | null;
}

export default class ReportSummaryRepository extends ReportCommonRepository {
  constructor(db: PrismaDb) {
    super(db);
  }

  async getSummary(filter: ReportFilter) {
    const receiptWhere = this.buildReceiptWhere(filter);

    /**
     * Fetch all CSPs under current scope
     */
    const csps = await this.db.agent.findMany({
      where: {
        // An empty scope is SUPER_ADMIN (all agents), not "none".
        ...(filter.agentIds.length > 0 && {
          agentId: {
            in: filter.agentIds,
          },
        }),

        type: AgentType.CSP,

        isDeleted: false,
      },

      select: {
        agentId: true,

        name: true,
      },

      orderBy: {
        name: "asc",
      },
    });

    /**
     * Fetch all receipts
     */
    const receipts = await this.db.receipt.findMany({
      where: receiptWhere,

      select: {
        agentId: true,

        transactionCategory: true,

        status: true,

        amount: true,
      },
    });

    /**
     * Fetch floats by agentIds
     */
    const floats = await this.db.agentFloat.findMany({
      where: {
        agentId: {
          in: filter.agentIds,
        },
      },

      select: {
        agentId: true,

        openingFloat: true,

        currentTotalFloat: true,
      },
    });

    /**
     * Report Map
     */
    const reportMap = new Map<string, ReportSummaryRow>();

    /**
     * Report Map
     */
    const floatMap = new Map(
      floats.map((item) => [
        item.agentId,
        {
          openingBalance: Number(item.openingFloat ?? 0),

          closingBalance: Number(item.currentTotalFloat ?? 0),
        },
      ]),
    );

    /**
     * Initialize every CSP
     */
    for (const csp of csps) {
      const services = {} as Record<
        TransactionCategory,
        {
          count: number;
          amount: number;
        }
      >;

      for (const category of Object.values(TransactionCategory)) {
        services[category] = {
          count: 0,
          amount: 0,
        };
      }

      reportMap.set(csp.agentId, {
        agentId: csp.agentId,

        agentName: csp.name,

        services,

        success: 0,

        failed: 0,

        total: 0,

        openingBalance: floatMap.get(csp.agentId)?.openingBalance ?? 0,

        closingBalance: floatMap.get(csp.agentId)?.closingBalance ?? 0,
      });
    }

    /**
     * Aggregate receipts
     */
    for (const receipt of receipts) {
      const row = reportMap.get(receipt.agentId);

      if (!row) {
        continue;
      }

      const service = row.services[receipt.transactionCategory];

      service.count++;

      if (receipt.status === ReceiptStatus.SUCCESS) {
        service.amount += Number(receipt.amount);
      }

      row.total++;

      switch (receipt.status) {
        case ReceiptStatus.SUCCESS:
          row.success++;
          break;

        case ReceiptStatus.FAILED:
          row.failed++;
          break;
      }
    }

    return Array.from(reportMap.values());
  }
}
