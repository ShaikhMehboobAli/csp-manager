import { PrismaDb } from "../../core/database/prisma.types";
import { Prisma } from "../../generated/prisma/client";

export default class MetricValueRepository {
  constructor(private readonly db: PrismaDb) {}

  findById(id: string) {
    return this.db.metricValue.findUnique({
      where: {
        id,
      },
      include: {
        metric: true,
        agent: {
          select: {
            agentId: true,
            name: true,
            type: true,
          },
        },
      },
    });
  }

  findByMetricAgentDate(metricId: string, agentId: string, date: Date) {
    return this.db.metricValue.findUnique({
      where: {
        metricId_agentId_date: {
          metricId,
          agentId,
          date,
        },
      },
    });
  }

  create(data: Prisma.MetricValueCreateInput) {
    return this.db.metricValue.create({
      data,
      include: {
        metric: true,
        agent: {
          select: {
            agentId: true,
            name: true,
            type: true,
          },
        },
      },
    });
  }

  update(id: string, data: Prisma.MetricValueUpdateInput) {
    return this.db.metricValue.update({
      where: {
        id,
      },
      data,
      include: {
        metric: true,
        agent: {
          select: {
            agentId: true,
            name: true,
            type: true,
          },
        },
      },
    });
  }

  findMany(where: Prisma.MetricValueWhereInput) {
    return this.db.metricValue.findMany({
      where,
      include: {
        metric: true,
        agent: {
          select: {
            agentId: true,
            name: true,
            type: true,
          },
        },
      },
      orderBy: {
        date: "desc",
      },
    });
  }
}
