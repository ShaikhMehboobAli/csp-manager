import { PrismaDb } from "../../../core/database/prisma.types";
import {
  AgentType,
  SubscriptionOwnerType,
} from "../../../generated/prisma/enums";
import SubscriptionRepository from "../../subscriptions/subscription.repository";
import { AuthenticatedMachine } from "./machine-auth.dto";

export type ReceiptWatcherReason = "BC_PLAN" | "CSP_SUBSCRIPTION" | "CSP_PLAN";

export interface ReceiptWatcherDecision {
  receiptWatcherAllowed: boolean;
  receiptWatcherReason: ReceiptWatcherReason;
}

/**
 * The background receipt watcher may run only when the machine is activated
 * under a BC plan and the CSP it works for (the agent itself, or a KO's parent
 * CSP) has no active subscription of its own. Otherwise CSP Manager counts
 * receipts through /receipts/upload-counts.
 */
export async function resolveReceiptWatcher(
  db: PrismaDb,
  authenticated: AuthenticatedMachine,
): Promise<ReceiptWatcherDecision> {
  if (authenticated.subscription.ownerType !== SubscriptionOwnerType.BC) {
    return { receiptWatcherAllowed: false, receiptWatcherReason: "CSP_PLAN" };
  }

  const agentId = authenticated.machine.currentAgentId;

  const agent = agentId
    ? await db.agent.findUnique({
        where: { agentId },
        select: { agentId: true, type: true, parentAgentId: true },
      })
    : null;

  const cspId =
    agent?.type === AgentType.KO ? agent.parentAgentId : agent?.agentId;

  if (cspId) {
    const subscribed = await new SubscriptionRepository(
      db,
    ).findOwnerIdsWithActiveSubscription(SubscriptionOwnerType.CSP, [cspId]);

    if (subscribed.has(cspId)) {
      return {
        receiptWatcherAllowed: false,
        receiptWatcherReason: "CSP_SUBSCRIPTION",
      };
    }
  }

  return { receiptWatcherAllowed: true, receiptWatcherReason: "BC_PLAN" };
}
