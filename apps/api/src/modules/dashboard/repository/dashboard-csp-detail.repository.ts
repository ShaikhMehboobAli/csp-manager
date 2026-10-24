import { PrismaDb } from "../../../core/database/prisma.types";

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

    const [receipts, manualMetricValues] = await Promise.all([
      this.db.receipt.findMany({
        where: {
          agentId: {
            in: hierarchyAgentIds,
          },
          transactionAt: {
            gte: from,
            lte: to,
          },
        },
        select: {
          agentId: true,
          receiptType: true,
          transactionCategory: true,
          transactionAt: true,
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

    return {
      csp,
      hierarchyAgentIds,
      metricDefinitions,
      receipts,
      manualMetricValues,
    };
  }
}
