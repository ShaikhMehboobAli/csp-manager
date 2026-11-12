import { Agent } from "../../generated/prisma/client";

export function mapOpeningBalance(agent: Agent) {
  return {
    cashInHand: Number(agent.openingCash ?? 0),
    // cashLimit is the CSP limit, not a balance.
    cashInAccount: Number(agent.openingCashInAccount ?? 0),
  };
}
