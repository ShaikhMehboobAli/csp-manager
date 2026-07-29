import { CurrentUser } from "../../../core/types/auth.types";
import { Agent, UserRole } from "../../../generated/prisma/client";

export function canManageAgent(
  currentUser: CurrentUser,
  agent: Agent,
): boolean {
  switch (currentUser.role) {
    case UserRole.SUPER_ADMIN:
      return true;

    case UserRole.BC_ADMIN:
      return (
        agent.agentId === currentUser.agentId ||
        agent.bcId === currentUser.agentId
      );

    case UserRole.CSP_ADMIN:
      return (
        agent.agentId === currentUser.agentId ||
        agent.parentAgentId === currentUser.agentId
      );

    default:
      return false;
  }
}
