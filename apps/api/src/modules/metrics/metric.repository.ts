import { PrismaDb } from "../../core/database/prisma.types";
import { Prisma } from "../../generated/prisma/client";

export default class MetricRepository {
  constructor(private readonly db: PrismaDb) {}

  findByCode(code: string) {
    return this.db.metricDefinition.findUnique({
      where: {
        code,
      },
    });
  }

  findById(id: string) {
    return this.db.metricDefinition.findUnique({
      where: {
        id,
      },
      include: {
        _count: {
          select: {
            values: true,
          },
        },
      },
    });
  }

  findMany(where: Prisma.MetricDefinitionWhereInput) {
    return this.db.metricDefinition.findMany({
      where,
      orderBy: [
        {
          category: "asc",
        },
        {
          name: "asc",
        },
      ],
    });
  }

  create(data: Prisma.MetricDefinitionCreateInput) {
    return this.db.metricDefinition.create({
      data,
    });
  }

  update(id: string, data: Prisma.MetricDefinitionUpdateInput) {
    return this.db.metricDefinition.update({
      where: {
        id,
      },
      data,
    });
  }
}
