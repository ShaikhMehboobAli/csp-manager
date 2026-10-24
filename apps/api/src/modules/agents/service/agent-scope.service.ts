import { PrismaDb } from "../../../core/database/prisma.types";
import { ForbiddenError } from "../../../core/errors/ForbiddenError";
import { CurrentUser } from "../../../core/types/auth.types";

import { AgentType, UserRole } from "../../../generated/prisma/enums";
import { AgentRepository } from "../repository/agent.repository";

export default class AgentScopeService {
  private readonly repository: AgentRepository;

  constructor(db: PrismaDb) {
    this.repository = new AgentRepository(db);
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
        const cspAgents = await this.repository.getCspAgents(
          //   [user.agentId],
          //   AgentType.CSP,
          user.agentId,
        );

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
