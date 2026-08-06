import { PrismaDb } from "../../../core/database/prisma.types";

import { ActivationStatus } from "../../../generated/prisma/enums";

import { DashboardFilter } from "../dashboard.types";

export default class DashboardActivationRepository {
  constructor(private readonly db: PrismaDb) {}

  async getActivationSummary(filter: DashboardFilter) {
    const where = filter.agentId
      ? {
          assignedAgentId: filter.agentId,
        }
      : {
          assignedAgentId: {
            in: filter.agentIds,
          },
        };

    const [total, used] = await Promise.all([
      //   this.db.activation.count({
      //     where,
      //   }),
      this.db.subscription.findFirst({
        where: {
          ownerId: filter.agentId ?? filter.currentAgentId,
        },
        select: {
          machineLimit: true,
        },
      }),

      //   this.db.activation.count({
      //     where: {
      //       ...where,

      //       status: ActivationStatus.ACTIVE,
      //     },
      //   }),
      this.db.activation.count({
        where: {
          ...where,
          status: {
            not: ActivationStatus.NOT_ACTIVATED,
          },
        },
      }),
    ]);

    return {
      total: total?.machineLimit ?? 0,

      used,

      unused: total?.machineLimit ? Math.max(total.machineLimit - used, 0) : 0,
    };
  }
}
