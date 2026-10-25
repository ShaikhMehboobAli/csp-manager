import { PrismaDb } from "../../../core/database/prisma.types";
import { ForbiddenError } from "../../../core/errors/ForbiddenError";
import { CurrentUser } from "../../../core/types/auth.types";

import {
  AgentType,
  SubscriptionOwnerType,
  UserRole,
} from "../../../generated/prisma/enums";
import { AgentRepository } from "../repository/agent.repository";
import SubscriptionRepository from "../../subscriptions/subscription.repository";

export default class AgentScopeService {
  private readonly repository: AgentRepository;
  private readonly subscriptionRepository: SubscriptionRepository;

  constructor(db: PrismaDb) {
    this.repository = new AgentRepository(db);
    this.subscriptionRepository = new SubscriptionRepository(db);
  }

  async getAgentScope(user: CurrentUser): Promise<string[]> {
    switch (user.role) {
      case UserRole.SUPER_ADMIN:
        return [];

      //   case UserRole.KO_ADMIN:
      //     return [user.agentId];

      case UserRole.CSP_ADMIN: {
        const koAgents = await this.repository.getChildAgents([user.agentId]);

        return [user.agentId, ...koAgents.map((agent) => agent.agentId)];
      }

      case UserRole.BC_ADMIN: {
        /**
         * Step 1
         * Fetch all CSPs under BC
         */
        const linkedCsps = await this.repository.getCspAgents(
          //   [user.agentId],
          //   AgentType.CSP,
          user.agentId,
        );

        const cspAgents = await this.withVisibleRequestLinks(linkedCsps);

        /**
         * Step 2
         * Fetch all KOs under those CSPs
         */
        const koAgents =
          cspAgents.length === 0
            ? []
            : await this.repository.getChildAgents(
                cspAgents.map((agent) => agent.agentId),
                AgentType.KO,
              );

        const scope = [
          //   user.agentId,

          ...cspAgents.map((agent) => agent.agentId),

          ...koAgents.map((agent) => agent.agentId),
        ];

        // An empty scope means "all agents" (SUPER_ADMIN only), so a BC with
        // no CSPs yet must still get a non-empty scope.
        return scope.length > 0 ? scope : [user.agentId];
      }

      default:
        return [user.agentId];
    }
  }

  /**
   * CSPs linked through an approved BC link request (BC ₹799 plan) stay
   * linked, but the BC sees their data only while the CSP's own subscription
   * is active.
   */
  private async withVisibleRequestLinks<
    T extends { agentId: string; bcLinkedByRequest: boolean },
  >(csps: T[]): Promise<T[]> {
    const requestLinked = csps
      .filter((csp) => csp.bcLinkedByRequest)
      .map((csp) => csp.agentId);

    if (requestLinked.length === 0) {
      return csps;
    }

    const subscribed =
      await this.subscriptionRepository.findOwnerIdsWithActiveSubscription(
        SubscriptionOwnerType.CSP,
        requestLinked,
      );

    return csps.filter(
      (csp) => !csp.bcLinkedByRequest || subscribed.has(csp.agentId),
    );
  }

  ensureAgentAccessible(
    requestedAgentId: string | undefined,
    allowedAgentIds: string[],
  ) {
    if (!requestedAgentId) {
      return;
    }

    // Empty scope = SUPER_ADMIN (all agents).
    if (allowedAgentIds.length === 0) {
      return;
    }

    if (!allowedAgentIds.includes(requestedAgentId)) {
      throw new ForbiddenError("You are not allowed to access this CSP.");
    }
  }
}
