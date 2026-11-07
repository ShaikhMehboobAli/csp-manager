/**
 * Data cleanup that keeps only the CSPs / KOs and their cash position:
 * agents (and their logins), each CSP's cash in account, every agent's cash
 * in hand and cash denomination (drawer), and open balance dues. The cash
 * limit is worked out again from those. Everything else that was recorded
 * (receipts, daily counts, ledgers, settlements, sessions, logs, OTPs,
 * notifications, …) is deleted. Configuration stays (plans, prices,
 * features, settings, commission rates, labels, running numbers).
 *
 *   npx tsx prisma/scripts/cleanup-keep-cash.ts                 dry run (counts only)
 *   npx tsx prisma/scripts/cleanup-keep-cash.ts --confirm       delete
 *   … --with-billing   also delete subscriptions, payments, mandates,
 *                      activations, revoke requests and machines (every PC
 *                      must re-activate and every CSP subscribe again)
 *
 * Refuses to run with NODE_ENV=production.
 */
import "dotenv/config";
import prisma from "../../src/config/prisma";
import { Prisma } from "../../src/generated/prisma/client";

const args = new Set(process.argv.slice(2));
const confirm = args.has("--confirm");
const withBilling = args.has("--with-billing");

type Step = { name: string; count: () => Promise<number>; run: () => Promise<{ count: number }> };

const step = (name: string, model: { count: (a?: any) => Promise<number>; deleteMany: (a?: any) => Promise<{ count: number }> }, where: object = {}): Step => ({
  name,
  count: () => model.count({ where }),
  run: () => model.deleteMany({ where }),
});

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to clean a production database.");
  }

  // Children before parents (foreign keys).
  const steps: Step[] = [
    step("FloatLedger", prisma.floatLedger),
    step("FloatAdjustmentRequest", prisma.floatAdjustmentRequest),
    step("CashLedger", prisma.cashLedger),
    step("CashRequest", prisma.cashRequest),
    step("CashSettlement (step 2)", prisma.cashSettlement, { parentId: { not: null } }),
    step("CashSettlement", prisma.cashSettlement),
    step("CashCustomTransaction", prisma.cashCustomTransaction),
    step("CashExchange", prisma.cashExchange),
    step("CashDayClose", prisma.cashDayClose),
    step("CashTask", prisma.cashTask),
    step("CashDrawerAdjustment", prisma.cashDrawerAdjustment),
    step("CashDue (settled / cancelled)", prisma.cashDue, { status: { not: "OPEN" } }),
    step("ReceiptReport", prisma.receiptReport),
    step("ReceiptCashDenomination", prisma.receiptCashDenomination),
    step("Receipt", prisma.receipt),
    step("ReceiptDailyCount", prisma.receiptDailyCount),
    step("MachineIdempotencyKey", prisma.machineIdempotencyKey),
    step("AuditLog", prisma.auditLog),
    step("CspActivitySession", prisma.cspActivitySession),
    step("MachineSession", prisma.machineSession),
    step("MetricValue", prisma.metricValue),
    step("CspVisitCustomerReview", prisma.cspVisitCustomerReview),
    step("CspVisit", prisma.cspVisit),
    step("Notification", prisma.notification),
    step("Communication", prisma.communication),
    step("Otp", prisma.otp),
    step("AgentEmailOtp", prisma.agentEmailOtp),
    step("UserSession", prisma.userSession),
  ];

  if (withBilling) {
    steps.push(
      step("Payment", prisma.payment),
      step("SubscriptionMandate", prisma.subscriptionMandate),
      step("SubscriptionHistory", prisma.subscriptionHistory),
      step("ActivationRevokeRequest", prisma.activationRevokeRequest),
      step("Activation", prisma.activation),
      step("Machine", prisma.machine),
      step("Subscription", prisma.subscription),
    );
  }

  console.log(`${confirm ? "Deleting" : "Dry run (add --confirm to delete)"}${withBilling ? " incl. billing and machines" : ""}:`);

  for (const item of steps) {
    const count = confirm ? (await item.run()).count : await item.count();

    console.log(`  ${item.name.padEnd(32)} ${count}`);
  }

  const pools = await prisma.cashPool.findMany();

  console.log(`\nCash kept for ${pools.length} CSP pool(s):`);

  for (const pool of pools) {
    const agents = await prisma.agent.findMany({
      where: {
        isDeleted: false,
        OR: [
          { agentId: pool.cspAgentId, type: "CSP" },
          { parentAgentId: pool.cspAgentId, type: "KO" },
        ],
      },
      select: { agentId: true },
    });

    const cash = await prisma.agentCash.findMany({
      where: { agentId: { in: agents.map((agent) => agent.agentId) } },
    });

    const hand = cash.reduce((total, row) => total.plus(row.cashInHand), new Prisma.Decimal(0));

    // Settlements and other cash are gone: limit = cash in hand + cash in
    // account + balance due held in the books.
    const limit = hand.plus(pool.cashInAccount).plus(pool.cashDueExtra);

    console.log(
      `  ${pool.cspAgentId.padEnd(16)} hand ${hand.toFixed(2)}  account ${pool.cashInAccount.toFixed(2)}  due ${pool.cashDueExtra.toFixed(2)}  → limit ${limit.toFixed(2)} (was ${pool.cashLimit.toFixed(2)})`,
    );

    if (!confirm) {
      continue;
    }

    await prisma.cashPool.update({
      where: { cspAgentId: pool.cspAgentId },
      data: { cashInTransit: 0, cashLeftInBank: 0, cashOther: 0, cashLimit: limit },
    });

    await prisma.cashLedger.create({
      data: {
        cspAgentId: pool.cspAgentId,
        type: "OPENING",
        cashInHandChange: hand,
        cashInAccountChange: pool.cashInAccount,
        cashLimitChange: limit,
        cashDueExtraChange: pool.cashDueExtra,
        balanceCashInAccount: pool.cashInAccount,
        balanceCashLimit: limit,
        balanceCashDueExtra: pool.cashDueExtra,
        actorType: "SYSTEM",
        remarks: "Baseline after data cleanup (cash in hand, cash in account, balance due kept)",
      },
    });

    await prisma.agent.updateMany({
      where: { agentId: pool.cspAgentId },
      data: { cashLimit: limit },
    });
  }


  console.log(confirm ? "\nDone." : "\nNothing was deleted.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
