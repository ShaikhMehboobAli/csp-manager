import { PrismaDb } from "../../../core/database/prisma.types";
import { fromIstCalendarDate } from "../../../core/utils/ist";
import { buildDailyCountWhere } from "../../receipts/repository/receipt-daily-count.repository";

export class DashboardCspDetailRepository {
  constructor(private readonly db: PrismaDb) {}

  async getCspDetail(
    bcAgentId: string,
    cspAgentId: string,
    from: Date,
    to: Date,
  ) {
    const csp = await this.db.agent.findFirst({
      where: {
        agentId: cspAgentId,
        type: "CSP",
        // Access is enforced by the caller's agent scope (BC: its CSPs,
        // CSP: itself, SUPER_ADMIN: all), so no bcId filter here.
        isDeleted: false,
      },
      select: {
        agentId: true,
        name: true,
        childAgents: {
          where: {
            type: "KO",
            isDeleted: false,
          },
          select: {
            agentId: true,
          },
        },
      },
    });

    if (!csp) {
      return null;
    }

    const hierarchyAgentIds = [
      csp.agentId,
      ...csp.childAgents.map((agent) => agent.agentId),
    ];

    const metricDefinitions = await this.db.metricDefinition.findMany({
      where: {
        category: "SOCIAL_SECURITY",
        isActive: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    const [dailyCounts, manualMetricValues] = await Promise.all([
      this.db.receiptDailyCount.groupBy({
        by: ["date", "agentId", "receiptType", "transactionCategory"],
        where: {
          ...buildDailyCountWhere({ from, to }),
          agentId: {
            in: hierarchyAgentIds,
          },
        },
        _sum: {
          count: true,
        },
      }),

      this.db.metricValue.findMany({
        where: {
          agentId: csp.agentId,
          metricId: {
            in: metricDefinitions
              .filter((metric) => metric.source === "MANUAL")
              .map((metric) => metric.id),
          },
          date: {
            gte: from,
            lte: to,
          },
        },
        select: {
          metricId: true,
          agentId: true,
          date: true,
          value: true,
        },
      }),
    ]);

    // One row per IST day and receipt kind; `count` receipts each.
    const receipts = dailyCounts.map((row) => ({
      agentId: row.agentId,
      receiptType: row.receiptType,
      transactionCategory: row.transactionCategory,
      transactionAt: fromIstCalendarDate(row.date),
      count: row._sum.count ?? 0,
    }));

    return {
      csp,
      hierarchyAgentIds,
      metricDefinitions,
      receipts,
      manualMetricValues,
    };
  }
}
