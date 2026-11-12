import { Agent } from "../../../generated/prisma/client";

export function mapAgent(agent: Agent) {
  return {
    id: agent.id,

    agentId: agent.agentId,
    name: agent.name,
    type: agent.type,
    status: agent.status,

    mobile: agent.mobile,
    email: agent.email,
    // Verified by OTP on the desktop (null = not verified; cleared when the email changes).
    emailVerifiedAt: agent.emailVerifiedAt ?? null,
    address: agent.address,
    // SBI kiosk User ID when it differs from agentId (null = same as agentId).
    sbiUserId: agent.sbiUserId ?? null,

    bcId: agent.bcId,
    parentAgentId: agent.parentAgentId,

    cashLimit: agent.cashLimit?.toString() ?? null,
    openingCash: agent.openingCash?.toString() ?? null,
    openingCashInAccount: agent.openingCashInAccount?.toString() ?? null,

    linkedAt: agent.linkedAt,

    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}
