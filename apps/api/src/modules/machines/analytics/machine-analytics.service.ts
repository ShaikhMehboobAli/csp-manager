import { withTransaction } from "../../../core/database/transaction";
import { NotFoundError } from "../../../core/errors/NotFoundError";
import { CurrentUser } from "../../../core/types/auth.types";

import AgentScopeService from "../../agents/service/agent-scope.service";
import SubscriptionAccessValidator from "../../subscriptions/subscription-validator/subscription-access-validator";
import SubscriptionResolver from "../../subscriptions/subscription-validator/subscription-resolver.service";

import MachineListRepository from "../repository/machine-list.repository";

import MachineAnalyticsRepository from "./repository/machine-analytics.repository";
import { MachineAnalyticsFilter } from "./machine-analytics.types";
import { PrismaDb } from "../../../core/database/prisma.types";

export default class MachineAnalyticsService {
  constructor(private readonly db: PrismaDb) {}
  async getAnalytics(
    machineId: string,
    filter: Omit<
      MachineAnalyticsFilter,
      "machineId" | "currentAgentId" | "agentIds"
    >,
    user: CurrentUser,
  ) {
    return withTransaction(async (tx) => {
      // Validate subscription
      const resolver = new SubscriptionResolver(tx);

      const subscription = await resolver.getEffectiveSubscription(
        user.agentId,
      );

      SubscriptionAccessValidator.validate(subscription);

      // Get accessible agents
      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(user);

      // Validate machine access
      const machineRepository = new MachineListRepository(tx);

      const machine = await machineRepository.getMachine(machineId, agentIds);

      if (!machine) {
        throw new NotFoundError("Machine not found.");
      }

      const repository = new MachineAnalyticsRepository(tx);

      const analyticsFilter: MachineAnalyticsFilter = {
        machineId,

        currentAgentId: user.agentId,

        agentIds,

        from: filter.from,

        to: filter.to,

        groupBy: filter.groupBy,
      };

      const [summary, daily, sessions] = await Promise.all([
        repository.getSummary(analyticsFilter),

        repository.getDailyOnlineHours(analyticsFilter),

        repository.getSessionHistory(analyticsFilter),
      ]);
      //   const summary = await repository.getSummary(analyticsFilter);

      //   console.log("========== SUMMARY ==========");
      //   console.log(summary);

      //   const daily = await repository.getDailyOnlineHours(analyticsFilter);

      //   console.log("========== DAILY ==========");
      //   console.log(daily);

      //   const sessions = await repository.getSessionHistory(analyticsFilter);

      //   console.log("========== SESSIONS ==========");
      //   console.log(sessions);

      return {
        summary,

        daily,

        sessions,
      };
    });
  }
}
