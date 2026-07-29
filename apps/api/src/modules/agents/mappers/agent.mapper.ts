import { Agent } from "../../../generated/prisma/client";

export function mapAgent(agent: Agent) {
  return {
    id: agent.id,

    agentId: agent.agentId,
    name: agent.name,
    type: agent.type,

    mobile: agent.mobile,
    email: agent.email,
    address: agent.address,

    bcId: agent.bcId,
    parentAgentId: agent.parentAgentId,

    cashLimit: agent.cashLimit,
    openingCash: agent.openingCash,

    linkedAt: agent.linkedAt,

    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}
