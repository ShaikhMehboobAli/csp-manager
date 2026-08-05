import { PrismaDb } from "../database/prisma.types";

import { UserRole, AgentType } from "../../generated/prisma/enums";

export default class AccessService {
  constructor(private readonly db: PrismaDb) {}

  async getAccessibleAgentIds(user: {
    agentId: string;
    role: UserRole;
  }): Promise<string[]> {
    switch (user.role) {
      case UserRole.CSP_ADMIN:
        return [user.agentId];

      case UserRole.BC_ADMIN: {
        const csps = await this.db.agent.findMany({
          where: {
            bcId: user.agentId,
            type: AgentType.CSP,
            isDeleted: false,
          },

          select: {
            agentId: true,
          },
        });

        return csps.map((csp) => csp.agentId);
      }

      case UserRole.SUPER_ADMIN:
        return [];

      default:
        return [];
    }
  }
}
