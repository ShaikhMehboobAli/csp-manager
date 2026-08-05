import { Agent } from "../../generated/prisma/client";

export function mapOpeningBalance(agent: Agent) {
  return {
    cashInHand: Number(agent.openingCash ?? 0),
    cashInAccount: Number(agent.cashLimit ?? 0),
  };
}
