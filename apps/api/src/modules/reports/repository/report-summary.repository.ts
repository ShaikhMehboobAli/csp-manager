import { PrismaDb } from "../../../core/database/prisma.types";

import ReportCommonRepository from "./report-common.repository";

import { ReportFilter } from "../report.dto";

import {
  AgentType,
  ReceiptStatus,
  ReceiptType,
  TransactionCategory,
} from "../../../generated/prisma/enums";

export type SocialSecurityScheme = "PMJJBY" | "PMSBY" | "APY" | "OTHER";

function socialSecurityScheme(receiptType: ReceiptType): SocialSecurityScheme {
  switch (receiptType) {
    case ReceiptType.PMJJBY:
    case ReceiptType.PMSBY:
    case ReceiptType.APY:
      return receiptType;
    default:
      return "OTHER";
  }
}

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

  // SOCIAL_SECURITY counts split by scheme (receiptType).
  socialSecurity: Record<SocialSecurityScheme, number>;

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
    const countWhere = this.buildCountWhere(filter);

    /**
     * CSPs and KOs under current scope. One row per CSP, counting the CSP and
     * its KOs; a KO gets its own row only when its CSP isn't in view (e.g.
     * one KO selected).
     */
    const agents = await this.db.agent.findMany({
      where: {
        // An empty scope is SUPER_ADMIN (all agents), not "none".
        ...(filter.agentIds.length > 0 && {
          agentId: {
            in: filter.agentIds,
          },
        }),

        type: {
          in: [AgentType.CSP, AgentType.KO],
        },

        isDeleted: false,
      },

      select: {
        agentId: true,

        name: true,

        type: true,

        parentAgentId: true,
      },

      orderBy: {
        name: "asc",
      },
    });

    const cspIds = new Set(
      agents
        .filter((agent) => agent.type === AgentType.CSP)
        .map((agent) => agent.agentId),
    );

    const csps = agents.filter(
      (agent) =>
        agent.type === AgentType.CSP ||
        !agent.parentAgentId ||
        !cspIds.has(agent.parentAgentId),
    );

    // Receipts of a KO count on its CSP's row.
    const rowIdOf = new Map(
      agents.map((agent) => [
        agent.agentId,
        agent.type === AgentType.KO &&
        agent.parentAgentId &&
        cspIds.has(agent.parentAgentId)
          ? agent.parentAgentId
          : agent.agentId,
      ]),
    );

    /**
     * Receipt counts (daily counts outlive the receipts)
     */
    const receipts = await this.db.receiptDailyCount.groupBy({
      by: ["agentId", "transactionCategory", "receiptType", "status"],

      where: countWhere,

      _sum: {
        count: true,

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

        socialSecurity: { PMJJBY: 0, PMSBY: 0, APY: 0, OTHER: 0 },

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
      const row = reportMap.get(
        rowIdOf.get(receipt.agentId) ?? receipt.agentId,
      );

      if (!row) {
        continue;
      }

      const count = receipt._sum.count ?? 0;

      const service = row.services[receipt.transactionCategory];

      service.count += count;

      if (receipt.transactionCategory === TransactionCategory.SOCIAL_SECURITY) {
        row.socialSecurity[socialSecurityScheme(receipt.receiptType)] += count;
      }

      if (receipt.status === ReceiptStatus.SUCCESS) {
        service.amount += Number(receipt._sum.amount ?? 0);
      }

      row.total += count;

      switch (receipt.status) {
        case ReceiptStatus.SUCCESS:
          row.success += count;
          break;

        case ReceiptStatus.FAILED:
          row.failed += count;
          break;
      }
    }

    return Array.from(reportMap.values());
  }
}
