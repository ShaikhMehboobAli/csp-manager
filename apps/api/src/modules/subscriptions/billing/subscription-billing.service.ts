import { PrismaDb } from "../../../core/database/prisma.types";
import { BadRequestError } from "../../../core/errors/BadRequestError";
import { ConflictError } from "../../../core/errors/ConflictError";
import { NotFoundError } from "../../../core/errors/NotFoundError";
import { createCodeGeneratorService } from "../../../core/services/service.factory";
import { Prisma, Subscription } from "../../../generated/prisma/client";
import {
  BillingCycle,
  MandateStatus,
  NotificationKind,
  NotificationType,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
  SubscriptionEventType,
  SubscriptionOwnerType,
  SubscriptionStatus,
  SubscriptionType,
} from "../../../generated/prisma/enums";
import ActivationService from "../../activations/activation.service";
import ActivationRepository from "../../activations/activation.repository";
import NotificationService from "../../notifications/notification.service";
import BillingSettingsService from "../../settings/billing-settings.service";
import SubscriptionRepository from "../subscription.repository";

import { Logger } from "../../../core/utils/logger";
import { getMandateGateway, MandateCustomer } from "./mandate-gateway";

import {
  MANDATE_YEARS,
  RENEWAL_MAX_ATTEMPTS,
  RENEWAL_PENDING_TIMEOUT_MINUTES,
  RENEWAL_RETRY_MINUTES,
  RENEWAL_STUCK_HOURS,
  UPGRADE_WINDOW_DAYS,
} from "./billing.constants";

export { MANDATE_YEARS, RENEWAL_MAX_ATTEMPTS, RENEWAL_RETRY_MINUTES, UPGRADE_WINDOW_DAYS };

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const D = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);

export type OrderQuote = {
  purpose: PaymentPurpose;
  /** Base amount (without GST). */
  amount: Prisma.Decimal;
  pricePerMachine: Prisma.Decimal;
  previousPlanId: string | null;
  previousMachineCount: number | null;
  /** The running subscription an UPGRADE changes. */
  subscriptionId: string | null;
  breakdown: {
    planDifference: { machines: number; perMachine: string; amount: string } | null;
    newMachines: { machines: number; perMachine: string; amount: string } | null;
  } | null;
};

/** ACTIVE and not past its end (grace / renewal window included). */
export function isRunning(subscription: Pick<Subscription, "status" | "endDate" | "graceEndsAt">, now = new Date()) {
  return (
    subscription.status === SubscriptionStatus.ACTIVE &&
    (subscription.graceEndsAt ?? subscription.endDate) >= now
  );
}

export function upgradeWindowEndsAt(subscription: Pick<Subscription, "currentPeriodStart" | "startDate">) {
  const start = subscription.currentPeriodStart ?? subscription.startDate;

  return new Date(start.getTime() + UPGRADE_WINDOW_DAYS * DAY_MS);
}

/**
 * End date passed and the mandate charge is still being tried (up to 3
 * attempts). The plan is not usable meanwhile; a successful charge opens it
 * again.
 */
export function isRenewalPending(
  subscription: Pick<Subscription, "status" | "endDate" | "ownerType" | "autoRenew" | "cancelledAt" | "lapsedAt">,
  now = new Date(),
) {
  return (
    subscription.status === SubscriptionStatus.ACTIVE &&
    subscription.endDate < now &&
    renewsByMandate(subscription)
  );
}

/** Renews by mandate (CSP, not cancelled, not lapsed). */
/** Name, email and mobile of a plan owner (CSP agent or BC), for the payment gateway. */
export async function ownerContact(db: PrismaDb, ownerId: string): Promise<MandateCustomer> {
  const [agent, bc, user] = await Promise.all([
    db.agent.findUnique({ where: { agentId: ownerId }, select: { name: true, email: true, mobile: true } }),
    db.businessCorrespondent.findUnique({ where: { bcId: ownerId }, select: { name: true } }),
    db.user.findUnique({ where: { agentId: ownerId }, select: { email: true } }),
  ]);

  return {
    name: agent?.name ?? bc?.name ?? null,
    email: agent?.email ?? user?.email ?? null,
    contact: agent?.mobile ?? null,
  };
}

export function renewsByMandate(subscription: Pick<Subscription, "ownerType" | "autoRenew" | "cancelledAt" | "lapsedAt">) {
  return (
    subscription.ownerType === SubscriptionOwnerType.CSP &&
    subscription.autoRenew &&
    !subscription.cancelledAt &&
    !subscription.lapsedAt
  );
}

/**
 * CSP billing rules:
 * - No running subscription (or it was cancelled): PURCHASE at price × machines.
 * - Running: only an UPGRADE (higher plan and/or more machines) in the first
 *   12 days of the period, charged the difference only:
 *   (new price − old price) × old machines + new price × added machines.
 *   The end date doesn't change. Downgrades (lower plan / fewer machines)
 *   need a cancel and a new subscription.
 * - Renewal is automatic by UPI mandate; it isn't bought.
 * BC plans keep their earlier rules (renew / change from the app).
 */
export default class SubscriptionBillingService {
  private readonly repository: SubscriptionRepository;

  constructor(private readonly db: PrismaDb) {
    this.repository = new SubscriptionRepository(db);
  }

  async quote(input: {
    ownerType: SubscriptionOwnerType;
    ownerId: string;
    plan: { id: string; level: number; code: string; name: string };
    billingCycle: BillingCycle;
    unitPrice: Prisma.Decimal;
    machineCount: number;
  }): Promise<OrderQuote> {
    const purchase: OrderQuote = {
      purpose: PaymentPurpose.PURCHASE,
      amount: input.unitPrice.times(input.ownerType === SubscriptionOwnerType.CSP ? input.machineCount : 1),
      pricePerMachine: input.unitPrice,
      previousPlanId: null,
      previousMachineCount: null,
      subscriptionId: null,
      breakdown: null,
    };

    if (input.ownerType !== SubscriptionOwnerType.CSP) {
      return purchase;
    }

    const latest = await this.repository.findLatestSubscription(input.ownerType, input.ownerId);

    if (latest && isRenewalPending(latest)) {
      // The renewal charge decides within ~30 minutes: it renews the plan or
      // stops it (then a new purchase is allowed).
      throw new ConflictError(
        "Your plan's renewal payment is being charged through your UPI mandate. Please wait until it completes or fails (within about 30 minutes).",
        "RENEWAL_IN_PROGRESS",
      );
    }

    // A free trial is replaced by a purchase (its PCs carry over).
    if (!latest || !isRunning(latest) || latest.cancelledAt || latest.subscriptionType === SubscriptionType.TRIAL) {
      return purchase;
    }

    const current = await this.db.plan.findUnique({ where: { id: latest.planId } });

    if (!current) {
      throw new NotFoundError("Current plan not found.");
    }

    const sameTerms = latest.planId === input.plan.id && latest.machineLimit === input.machineCount;

    if (sameTerms) {
      throw new ConflictError(
        `You already have this plan. It renews automatically on ${latest.endDate.toISOString()} through your UPI mandate.`,
        "SUBSCRIPTION_ALREADY_ACTIVE",
      );
    }

    if (input.plan.level < current.level) {
      throw new BadRequestError(
        "Plans can't be downgraded. Cancel the subscription and take a new one when you want a lower plan.",
        "PLAN_DOWNGRADE_NOT_ALLOWED",
      );
    }

    if (input.machineCount < latest.machineLimit) {
      throw new BadRequestError(
        `Machines can't be reduced in the current plan (${latest.machineLimit} now). Cancel the subscription and take a new one with fewer machines.`,
        "MACHINE_DECREASE_NOT_ALLOWED",
      );
    }

    if (input.plan.level === current.level && latest.planId !== input.plan.id) {
      throw new BadRequestError(
        "Switching to another plan of the same level isn't an upgrade. Cancel and take a new subscription.",
        "PLAN_DOWNGRADE_NOT_ALLOWED",
      );
    }

    const windowEndsAt = upgradeWindowEndsAt(latest);

    if (Date.now() > windowEndsAt.getTime()) {
      throw new BadRequestError(
        `Upgrades are allowed only in the first ${UPGRADE_WINDOW_DAYS} days of the plan or its last renewal (until ${windowEndsAt.toISOString()}).`,
        "UPGRADE_WINDOW_CLOSED",
      );
    }

    const oldPrice =
      latest.pricePerMachine !== null
        ? D(latest.pricePerMachine)
        : await this.currentUnitPrice(latest.planId, input.billingCycle);

    const newPrice = input.unitPrice;
    const added = input.machineCount - latest.machineLimit;
    const perMachineDifference = Prisma.Decimal.max(newPrice.minus(oldPrice), 0);
    const planDifference = perMachineDifference.times(latest.machineLimit);
    const newMachines = newPrice.times(added);

    return {
      purpose: PaymentPurpose.UPGRADE,
      amount: planDifference.plus(newMachines),
      pricePerMachine: newPrice,
      previousPlanId: latest.planId,
      previousMachineCount: latest.machineLimit,
      subscriptionId: latest.id,
      breakdown: {
        planDifference:
          latest.planId === input.plan.id
            ? null
            : {
                machines: latest.machineLimit,
                perMachine: perMachineDifference.toFixed(2),
                amount: planDifference.toFixed(2),
              },
        newMachines:
          added > 0
            ? { machines: added, perMachine: newPrice.toFixed(2), amount: newMachines.toFixed(2) }
            : null,
      },
    };
  }

  /** Paid upgrade: same subscription, same dates; new plan / machine count. */
  async applyUpgrade(payment: {
    id: string;
    planId: string;
    machineCount: number;
    amount: Prisma.Decimal;
    previousPlanId: string | null;
    ownerId: string;
  }) {
    const latest = await this.repository.findLatestSubscription(SubscriptionOwnerType.CSP, payment.ownerId);

    if (!latest || !isRunning(latest) || latest.cancelledAt) {
      throw new ConflictError(
        "The subscription this upgrade was for is no longer running. Contact support for a refund of this payment.",
        "UPGRADE_TARGET_GONE",
      );
    }

    if (latest.machineLimit > payment.machineCount) {
      throw new ConflictError("This upgrade is out of date: the subscription already has more machines.");
    }

    const pricing = await this.db.planPricing.findUnique({
      where: { planId_billingCycle: { planId: payment.planId, billingCycle: BillingCycle.MONTHLY } },
    });

    const subscription = await this.db.subscription.update({
      where: { id: latest.id },
      data: {
        planId: payment.planId,
        machineLimit: payment.machineCount,
        pricePerMachine: pricing?.price ?? latest.pricePerMachine,
        amountPaid: { increment: payment.amount },
      },
    });

    await new ActivationService().generateActivations(
      { subscriptionId: subscription.id, machineLimit: subscription.machineLimit, expiresAt: subscription.endDate },
      this.db,
    );

    await this.repository.createHistory({
      subscriptionId: subscription.id,
      eventType: SubscriptionEventType.UPGRADE,
      previousPlanId: latest.planId,
      newPlanId: payment.planId,
      amount: Number(payment.amount),
      remarks: `Machines ${latest.machineLimit} → ${payment.machineCount}`,
    });

    await this.updateMandateAmount(subscription);

    return subscription;
  }

  /**
   * After a PURCHASE: price, period and the monthly mandate. Renewals charge
   * the plan's current monthly price (a price changed after the order was
   * opened applies from the first renewal); `paidPerMachine` is the fallback
   * when the plan has no monthly price.
   */
  /** `registrationPaymentId`: the gateway payment of the purchase (Razorpay: it also registered UPI AutoPay). */
  async setUpNewSubscription(subscription: Subscription, paidPerMachine: Prisma.Decimal, registrationPaymentId?: string | null) {
    if (subscription.ownerType !== SubscriptionOwnerType.CSP) {
      return subscription;
    }

    const current = await this.db.planPricing.findUnique({
      where: { planId_billingCycle: { planId: subscription.planId, billingCycle: BillingCycle.MONTHLY } },
    });
    const pricePerMachine = current ? D(current.price) : paidPerMachine;

    const updated = await this.db.subscription.update({
      where: { id: subscription.id },
      data: {
        pricePerMachine,
        currentPeriodStart: subscription.startDate,
        autoRenew: true,
        // Usable until the end date only; renewal retries don't extend it.
        graceEndsAt: null,
      },
    });

    await this.createMandate(updated, registrationPaymentId);

    return updated;
  }

  /** Cancel: no refund, works until the end date, the mandate is cancelled. */
  async cancel(input: { ownerId: string; userId: string; reason?: string }) {
    const found = await this.repository.findLatestSubscription(SubscriptionOwnerType.CSP, input.ownerId);

    if (found) {
      await this.db.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${found.id} FOR UPDATE`;
    }

    const latest = found ? await this.db.subscription.findUnique({ where: { id: found.id } }) : null;
    // End date passed, renewal still being charged: cancelling stops the
    // retries and the plan ends now.
    const renewalPending = !!latest && isRenewalPending(latest);

    if (!latest || (!isRunning(latest) && !renewalPending)) {
      throw new BadRequestError("You have no running subscription to cancel.");
    }

    if (latest.cancelledAt) {
      throw new ConflictError("This subscription is already cancelled.", "SUBSCRIPTION_ALREADY_CANCELLED");
    }

    // A trial ends on its own; there's no mandate to stop.
    if (latest.subscriptionType === SubscriptionType.TRIAL) {
      throw new BadRequestError(
        "A free trial can't be cancelled; it ends on its own. Buy a plan to keep using the app.",
        "TRIAL_CANCEL_NOT_ALLOWED",
      );
    }

    if (renewalPending) {
      const waiting = await this.db.payment.findFirst({
        where: { subscriptionId: latest.id, purpose: PaymentPurpose.RENEWAL, status: PaymentStatus.PENDING },
      });

      if (waiting) {
        // The gateway may still take the money; let it answer first.
        throw new ConflictError(
          "A renewal payment is waiting for the bank's answer. Try again in a few minutes.",
          "RENEWAL_IN_PROGRESS",
        );
      }
    }

    const subscription = await this.db.subscription.update({
      where: { id: latest.id },
      data: {
        cancelledAt: new Date(),
        cancelledBy: input.userId,
        cancelReason: input.reason,
        autoRenew: false,
        nextRenewalAttemptAt: null,
        // Usable until the end date only (no grace, no renewal window).
        graceEndsAt: null,
        ...(renewalPending && { status: SubscriptionStatus.EXPIRED }),
      },
    });

    await this.cancelMandates(subscription.id, MandateStatus.CANCELLED);

    await this.repository.createHistory({
      subscriptionId: subscription.id,
      eventType: SubscriptionEventType.CANCELLATION,
      previousPlanId: subscription.planId,
      newPlanId: subscription.planId,
      amount: 0,
      remarks: input.reason ?? "Cancelled by the CSP (no refund).",
    });

    await new NotificationService(this.db).notifyAgent(input.ownerId, {
      title: "Subscription cancelled",
      message: renewalPending
        ? `Your subscription ${subscription.subscriptionNumber} is cancelled and has stopped; its renewal won't be charged. No refund is made.`
        : `Your subscription ${subscription.subscriptionNumber} is cancelled and won't renew. You can use it until ${subscription.endDate.toISOString()}. No refund is made.`,
      kind: NotificationKind.SUBSCRIPTION_CANCELLED,
      type: NotificationType.WARNING,
      data: { subscriptionId: subscription.id, endDate: subscription.endDate.toISOString() },
    });

    return subscription;
  }

  // ---------------------------------------------------------------------------
  // Mandates and renewals
  // ---------------------------------------------------------------------------

  /**
   * A new monthly mandate for the subscription. Never throws for gateway
   * problems (a purchase is already paid): the mandate is then left PENDING
   * without an approval link, and the CSP can ask for one with
   * POST /payments/mandates/setup.
   */
  async createMandate(subscription: Subscription, registrationPaymentId?: string | null) {
    const gateway = getMandateGateway();
    const amount = await this.monthlyAmount(subscription);
    // The first charge is on the end date (now, when it has already passed).
    const startAt = subscription.endDate > new Date() ? subscription.endDate : new Date();
    const endAt = new Date(subscription.startDate);

    endAt.setFullYear(endAt.getFullYear() + MANDATE_YEARS);

    let created: Awaited<ReturnType<typeof gateway.createMandate>>;
    let failure: string | null = null;

    try {
      created = await gateway.createMandate({
        subscriptionId: subscription.id,
        ownerId: subscription.ownerId,
        amount: Number(amount),
        startAt,
        endAt,
        registrationPaymentId,
        customer: await ownerContact(this.db, subscription.ownerId),
      });
    } catch (error) {
      failure = (error as Error).message;
      Logger.error(`[Billing] Mandate for ${subscription.subscriptionNumber} not created: ${failure}`);
      created = {
        providerMandateId: null,
        providerCustomerId: null,
        providerRegistrationId: null,
        status: MandateStatus.PENDING,
        authUrl: null,
        maxAmount: null,
      };
    }

    const mandate = await this.db.subscriptionMandate.create({
      data: {
        subscriptionId: subscription.id,
        ownerId: subscription.ownerId,
        provider: gateway.provider,
        providerMandateId: created.providerMandateId,
        providerCustomerId: created.providerCustomerId,
        providerRegistrationId: created.providerRegistrationId,
        maxAmount: created.maxAmount,
        status: created.status,
        amount,
        startAt,
        endAt,
        authUrl: created.authUrl,
        revokeReason: failure ? `Not set up: ${failure.slice(0, 200)}` : null,
        activatedAt: created.status === MandateStatus.ACTIVE ? new Date() : null,
      },
    });

    if (mandate.providerMandateId) {
      await this.applyWaitingTokenEvents(mandate.providerMandateId);
    }

    return this.db.subscriptionMandate.findUniqueOrThrow({ where: { id: mandate.id } });
  }

  /**
   * CSP asks for a UPI AutoPay approval link for its running plan (no
   * approved mandate yet, or it was removed in the UPI app). Pending
   * mandates without a link are replaced.
   */
  async setUpMandate(ownerId: string) {
    const subscription = await this.db.subscription.findFirst({
      where: { ownerType: SubscriptionOwnerType.CSP, ownerId, status: SubscriptionStatus.ACTIVE },
      orderBy: { createdAt: "desc" },
    });

    if (!subscription || !renewsByMandate(subscription)) {
      throw new BadRequestError("You have no running plan that renews by UPI AutoPay.", "NO_RENEWING_PLAN");
    }

    await this.db.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${subscription.id} FOR UPDATE`;

    const existing = await this.db.subscriptionMandate.findFirst({
      where: { subscriptionId: subscription.id, status: { in: [MandateStatus.ACTIVE, MandateStatus.PENDING] } },
      orderBy: { createdAt: "desc" },
    });

    if (existing && (existing.status === MandateStatus.ACTIVE || existing.authUrl)) {
      return existing;
    }

    const mandate = await this.createMandate(subscription);

    await this.cancelMandates(subscription.id, MandateStatus.REPLACED, "A new approval link was made.", mandate.id);

    return mandate;
  }

  // ---------------------------------------------------------------------------
  // Razorpay token events (webhooks)
  // ---------------------------------------------------------------------------

  /**
   * The customer approved: the registration (purchase order or approval
   * link) now has a UPI token. Links it to its mandate and applies token
   * events that arrived before it.
   */
  async linkMandateToken(input: { registrationId: string; tokenId: string; customerId?: string | null; approved?: boolean }) {
    const mandate = await this.db.subscriptionMandate.findUnique({ where: { providerRegistrationId: input.registrationId } });

    if (!mandate) {
      return false;
    }

    if (!mandate.providerMandateId) {
      await this.db.subscriptionMandate.update({
        where: { id: mandate.id },
        data: {
          providerMandateId: input.tokenId,
          ...(input.customerId && !mandate.providerCustomerId && { providerCustomerId: input.customerId }),
        },
      });
    }

    // A captured first payment on a UPI AutoPay order / approval link means the
    // customer approved the mandate (Razorpay doesn't capture it otherwise), so
    // it's active without waiting for token.confirmed (not every account gets
    // token webhooks).
    if (input.approved) {
      await this.db.subscriptionMandate.updateMany({
        where: { id: mandate.id, status: MandateStatus.PENDING, cancelledAt: null },
        data: { status: MandateStatus.ACTIVE, activatedAt: new Date(), authUrl: null },
      });
    }

    await this.applyWaitingTokenEvents(input.tokenId);

    return true;
  }

  /** token.confirmed / rejected / cancelled / paused. Returns false when no mandate has this token yet. */
  async tokenStatusChanged(tokenId: string, status: "confirmed" | "rejected" | "cancelled" | "paused", reason?: string | null) {
    const mandate = await this.db.subscriptionMandate.findUnique({ where: { providerMandateId: tokenId } });

    if (!mandate) {
      return false;
    }

    if (status === "confirmed") {
      await this.db.subscriptionMandate.updateMany({
        where: { id: mandate.id, status: { in: [MandateStatus.PENDING, MandateStatus.REVOKED] }, cancelledAt: null },
        data: { status: MandateStatus.ACTIVE, activatedAt: new Date(), revokedAt: null, revokeReason: null, authUrl: null },
      });

      return true;
    }

    if (mandate.status === MandateStatus.REPLACED || mandate.status === MandateStatus.CANCELLED) {
      // We cancelled it ourselves (price change, cancel): nothing to tell.
      return true;
    }

    const why = {
      rejected: "You didn't approve the UPI AutoPay request.",
      cancelled: "The UPI AutoPay mandate was cancelled in your UPI app or bank.",
      paused: "The UPI AutoPay mandate was paused in your UPI app.",
    }[status];

    await this.mandateRevoked(mandate.id, reason ? `${why} (${reason})` : why);

    return true;
  }

  private async applyWaitingTokenEvents(tokenId: string) {
    const events = await this.db.razorpayWebhookEvent.findMany({
      where: { entityId: tokenId, processedAt: null, event: { startsWith: "token." } },
      orderBy: { createdAt: "asc" },
    });

    for (const event of events) {
      const status = event.event.slice("token.".length) as "confirmed" | "rejected" | "cancelled" | "paused";
      const entity = (event.payload as { payload?: { token?: { entity?: { recurring_details?: { failure_reason?: string } } } } })
        .payload?.token?.entity;

      if (await this.tokenStatusChanged(tokenId, status, entity?.recurring_details?.failure_reason)) {
        await this.db.razorpayWebhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
      }
    }
  }

  /**
   * Charges the mandate for a subscription whose end date has come (renewal
   * job). One attempt; failures are retried by the job until the 3rd.
   */
  async chargeRenewal(subscriptionId: string) {
    await this.db.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${subscriptionId} FOR UPDATE`;

    const subscription = await this.db.subscription.findUnique({ where: { id: subscriptionId } });
    const latestMandate = await this.db.subscriptionMandate.findFirst({
      where: { subscriptionId, status: { in: [MandateStatus.ACTIVE, MandateStatus.PENDING] } },
      orderBy: { createdAt: "desc" },
    });
    // Razorpay starts 48 h before the end date (UPI pre-debit notice); the dev stand-in on it.
    const policy = getMandateGateway(latestMandate?.provider).policy;

    if (
      !subscription ||
      subscription.status !== SubscriptionStatus.ACTIVE ||
      !renewsByMandate(subscription) ||
      subscription.endDate.getTime() - policy.leadHours * 60 * MINUTE_MS > Date.now() ||
      (subscription.nextRenewalAttemptAt && subscription.nextRenewalAttemptAt > new Date())
    ) {
      return { status: "SKIPPED" as const };
    }

    const pending = await this.db.payment.findFirst({
      where: { subscriptionId, purpose: PaymentPurpose.RENEWAL, status: PaymentStatus.PENDING },
    });

    if (pending) {
      if (Date.now() - pending.createdAt.getTime() < policy.pendingTimeoutMinutes * MINUTE_MS) {
        // Waiting for the gateway's answer (webhook).
        return { status: "WAITING" as const };
      }

      // No answer in time: count it as a failed attempt (retry / lapse). A late
      // success still renews the plan (completeRenewal accepts it).
      await this.failRenewal(pending.id, "No answer from the payment gateway.", true);

      return { status: "FAILED" as const };
    }

    const mandate = await this.db.subscriptionMandate.findFirst({
      where: { subscriptionId, status: MandateStatus.ACTIVE },
      orderBy: { createdAt: "desc" },
    });

    if (!mandate) {
      // Removed in the UPI app / never approved: nothing to retry with.
      await this.lapse(subscription, "No active UPI mandate to charge.");

      return { status: "LAPSED" as const };
    }

    const attempt = subscription.renewalAttempts + 1;
    const gst = await new BillingSettingsService(this.db).withGst(
      Number(subscription.pricePerMachine ?? (await this.currentUnitPrice(subscription.planId, BillingCycle.MONTHLY))) *
        subscription.machineLimit,
    );

    const payment = await this.db.payment.create({
      data: {
        paymentNumber: await createCodeGeneratorService(this.db).generatePaymentNumber(),
        subscriptionId,
        ownerType: subscription.ownerType,
        ownerId: subscription.ownerId,
        machineCount: subscription.machineLimit,
        amount: gst.amount,
        taxAmount: gst.taxAmount,
        taxPercent: gst.gstPercent,
        totalAmount: gst.totalAmount,
        paymentMethod: PaymentMethod.UPI,
        paymentProvider: mandate.provider === "RAZORPAY" ? "RAZORPAY" : "MANUAL",
        status: PaymentStatus.PENDING,
        planId: subscription.planId,
        billingCycle: BillingCycle.MONTHLY,
        purpose: PaymentPurpose.RENEWAL,
        mandateId: mandate.id,
        attemptNumber: attempt,
        currency: "INR",
      },
    });

    const result = await getMandateGateway(mandate.provider).charge({
      mandate,
      paymentId: payment.id,
      paymentNumber: payment.paymentNumber,
      subscriptionId,
      amount: Number(gst.totalAmount),
      customer: await ownerContact(this.db, subscription.ownerId),
    });

    if (result.status === "SUCCESS") {
      await this.completeRenewal(payment.id, result.gatewayTransactionId);

      return { status: "RENEWED" as const };
    }

    if (result.status === "PENDING") {
      if (result.transactionReference || result.gatewayPaymentId) {
        await this.db.payment.update({
          where: { id: payment.id },
          data: {
            transactionReference: result.transactionReference,
            gatewayResponse: { orderId: result.transactionReference ?? null, gatewayPaymentId: result.gatewayPaymentId ?? null },
          },
        });
      }

      await this.db.subscription.update({
        where: { id: subscriptionId },
        data: { nextRenewalAttemptAt: new Date(Date.now() + policy.retryMinutes * MINUTE_MS) },
      });

      return { status: "WAITING" as const };
    }

    await this.failRenewal(payment.id, result.failureReason, result.retryable);

    return { status: "FAILED" as const };
  }

  /**
   * Safety net (renewal job): a mandate renewal still unresolved hours after
   * the end date (the charge kept erroring, the gateway never answered) is
   * stopped so the plan doesn't stay blocked-but-ACTIVE forever. A late
   * successful charge still brings it back.
   */
  async lapseStuckRenewals(now = new Date()) {
    const stuck = await this.db.subscription.findMany({
      where: {
        ownerType: SubscriptionOwnerType.CSP,
        status: SubscriptionStatus.ACTIVE,
        autoRenew: true,
        cancelledAt: null,
        lapsedAt: null,
        endDate: { lt: new Date(now.getTime() - RENEWAL_STUCK_HOURS * 60 * MINUTE_MS) },
      },
      take: 100,
    });

    for (const subscription of stuck) {
      await this.lapse(subscription, "The renewal payment could not be completed.");
    }

    return stuck.length;
  }

  /** Mandate charge succeeded: one more month from the old end date. */
  async completeRenewal(paymentId: string, gatewayTransactionId: string) {
    const payment = await this.db.payment.findUnique({ where: { id: paymentId } });

    if (!payment || payment.purpose !== PaymentPurpose.RENEWAL || !payment.subscriptionId) {
      throw new NotFoundError("Renewal payment not found.");
    }

    if (payment.status === PaymentStatus.SUCCESS) {
      return;
    }

    const subscription = await this.db.subscription.findUniqueOrThrow({ where: { id: payment.subscriptionId } });

    // A timed-out attempt the bank charged after a later attempt already
    // renewed this period: don't extend twice.
    const renewedLater =
      payment.status === PaymentStatus.FAILED &&
      !!(await this.db.payment.findFirst({
        where: {
          subscriptionId: subscription.id,
          purpose: PaymentPurpose.RENEWAL,
          status: PaymentStatus.SUCCESS,
          createdAt: { gt: payment.createdAt },
        },
      }));

    const latest =
      subscription.status !== SubscriptionStatus.ACTIVE
        ? await this.repository.findLatestSubscription(subscription.ownerType, subscription.ownerId)
        : null;
    const replacedByNewPlan = !!latest && latest.id !== subscription.id;

    {
      if (renewedLater || replacedByNewPlan) {
        // Don't revive / extend (two running plans, or a month twice). Record
        // the money and flag it for a refund.
        await this.db.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.SUCCESS,
            paidAt: new Date(),
            gatewayTransactionId,
            failureReason: replacedByNewPlan
              ? "Charged after the plan stopped and a new plan was bought: refund due."
              : "Charged after another attempt already renewed this period: refund due.",
          },
        });

        await new NotificationService(this.db).notifyAgent(subscription.ownerId, {
          title: "Late renewal charge",
          message: replacedByNewPlan
            ? `₹${payment.totalAmount.toFixed(2)} was charged for your old plan ${subscription.subscriptionNumber} after it had stopped. You already have a new plan, so this amount will be refunded.`
            : `₹${payment.totalAmount.toFixed(2)} was charged twice for the same renewal of ${subscription.subscriptionNumber}. The extra amount will be refunded.`,
          kind: NotificationKind.SUBSCRIPTION_RENEWAL_FAILED,
          type: NotificationType.WARNING,
          data: { subscriptionId: subscription.id, paymentId: payment.id, refundDue: true },
        });

        return;
      }
    }

    const pricing = await this.db.planPricing.findUnique({
      where: { planId_billingCycle: { planId: subscription.planId, billingCycle: BillingCycle.MONTHLY } },
    });
    const durationDays = pricing?.durationDays ?? 30;
    const periodStart = subscription.endDate;
    const endDate = new Date(periodStart.getTime() + durationDays * DAY_MS);

    await this.db.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.SUCCESS,
        paidAt: new Date(),
        gatewayTransactionId,
        invoiceNumber: await createCodeGeneratorService(this.db).generateInvoiceNumber(),
      },
    });

    const renewed = await this.db.subscription.update({
      where: { id: subscription.id },
      data: {
        // A charge that arrives after the plan lapsed brings it back.
        status: SubscriptionStatus.ACTIVE,
        lapsedAt: null,
        endDate,
        currentPeriodStart: periodStart,
        graceEndsAt: null,
        renewalAttempts: 0,
        nextRenewalAttemptAt: null,
        lastRenewalFailure: null,
        amountPaid: { increment: payment.amount },
      },
    });

    await new ActivationRepository(this.db).updateSubscriptionActivationExpiry(renewed.id, endDate);

    await this.repository.createHistory({
      subscriptionId: renewed.id,
      eventType: SubscriptionEventType.RENEWAL,
      previousPlanId: renewed.planId,
      newPlanId: renewed.planId,
      amount: Number(payment.amount),
      remarks: `Auto renewal by UPI mandate (attempt ${payment.attemptNumber ?? 1}).`,
    });

    await new NotificationService(this.db).notifyAgent(renewed.ownerId, {
      title: "Subscription renewed",
      message: `₹${payment.totalAmount.toFixed(2)} was charged through your UPI mandate. Your plan now runs until ${endDate.toISOString()}.`,
      kind: NotificationKind.SUBSCRIPTION_RENEWED,
      type: NotificationType.SUCCESS,
      data: { subscriptionId: renewed.id, paymentId: payment.id, endDate: endDate.toISOString() },
    });
  }

  /** Mandate charge failed: retry in 15 minutes, or stop the plan after the 3rd attempt. */
  async failRenewal(paymentId: string, reason: string, retryable = true) {
    const payment = await this.db.payment.findUnique({ where: { id: paymentId } });

    if (!payment || !payment.subscriptionId || payment.status !== PaymentStatus.PENDING) {
      return;
    }

    await this.db.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.FAILED, failureReason: reason },
    });

    const subscription = await this.db.subscription.findUniqueOrThrow({ where: { id: payment.subscriptionId } });
    const attempts = subscription.renewalAttempts + 1;
    const mandate = payment.mandateId ? await this.db.subscriptionMandate.findUnique({ where: { id: payment.mandateId } }) : null;
    const policy = getMandateGateway(mandate?.provider).policy;

    await this.repository.createHistory({
      subscriptionId: subscription.id,
      eventType: SubscriptionEventType.RENEWAL_FAILED,
      previousPlanId: subscription.planId,
      newPlanId: subscription.planId,
      amount: 0,
      remarks: `Attempt ${attempts} of ${policy.maxAttempts}: ${reason}`,
    });

    if (!retryable || attempts >= policy.maxAttempts) {
      if (subscription.endDate > new Date()) {
        // Failed before the end date (Razorpay starts 48 h early): the plan
        // keeps working until its end date, then ends (no more charges).
        await this.db.subscription.update({
          where: { id: subscription.id },
          data: { renewalAttempts: attempts, lastRenewalFailure: reason, autoRenew: false, nextRenewalAttemptAt: null },
        });

        await new NotificationService(this.db).notifyAgent(subscription.ownerId, {
          title: "Renewal payment failed",
          message: `We couldn't renew your plan through UPI AutoPay (${reason}). It keeps working until ${subscription.endDate.toISOString()} and then stops. Renew or take a new plan in the app to continue.`,
          kind: NotificationKind.SUBSCRIPTION_RENEWAL_FAILED,
          type: NotificationType.WARNING,
          data: { subscriptionId: subscription.id, attempt: attempts, endsAt: subscription.endDate.toISOString(), autoRenew: false },
        });

        return;
      }

      await this.db.subscription.update({
        where: { id: subscription.id },
        data: { renewalAttempts: attempts, lastRenewalFailure: reason },
      });

      await this.lapse({ ...subscription, renewalAttempts: attempts }, reason);

      return;
    }

    const next = new Date(Date.now() + policy.retryMinutes * MINUTE_MS);

    await this.db.subscription.update({
      where: { id: subscription.id },
      data: {
        renewalAttempts: attempts,
        nextRenewalAttemptAt: next,
        lastRenewalFailure: reason,
      },
    });

    await new NotificationService(this.db).notifyAgent(subscription.ownerId, {
      title: "Renewal payment failed",
      message: `We couldn't charge your UPI mandate (${reason}). Your plan is paused until the payment goes through. We'll try again at ${next.toISOString()} (attempt ${attempts + 1} of ${policy.maxAttempts}). Keep enough balance in your account.`,
      kind: NotificationKind.SUBSCRIPTION_RENEWAL_FAILED,
      type: NotificationType.WARNING,
      data: { subscriptionId: subscription.id, attempt: attempts, nextAttemptAt: next.toISOString() },
    });
  }

  /** Renewal failed for good: the plan stops now (no grace). */
  async lapse(subscription: Subscription, reason: string) {
    await this.db.subscription.update({
      where: { id: subscription.id },
      data: {
        status: SubscriptionStatus.EXPIRED,
        lapsedAt: new Date(),
        graceEndsAt: new Date(),
        autoRenew: false,
        nextRenewalAttemptAt: null,
        lastRenewalFailure: reason,
      },
    });

    await this.repository.createHistory({
      subscriptionId: subscription.id,
      eventType: SubscriptionEventType.LAPSED,
      previousPlanId: subscription.planId,
      newPlanId: subscription.planId,
      amount: 0,
      remarks: reason,
    });

    await new NotificationService(this.db).notifyAgent(subscription.ownerId, {
      title: "Subscription stopped",
      message: `Your subscription couldn't be renewed (${reason}) and has stopped. Renew or take a new plan in the app to continue.`,
      kind: NotificationKind.SUBSCRIPTION_LAPSED,
      type: NotificationType.ERROR,
      data: { subscriptionId: subscription.id },
    });
  }

  /** Gateway webhook: the customer removed the mandate in the UPI app / bank. */
  async mandateRevoked(mandateId: string, reason?: string) {
    const mandate = await this.db.subscriptionMandate.findUnique({ where: { id: mandateId } });

    if (!mandate) {
      throw new NotFoundError("Mandate not found.");
    }

    if (mandate.status === MandateStatus.REVOKED || mandate.status === MandateStatus.CANCELLED) {
      return mandate;
    }

    const updated = await this.db.subscriptionMandate.update({
      where: { id: mandate.id },
      data: { status: MandateStatus.REVOKED, revokedAt: new Date(), revokeReason: reason },
    });

    await new NotificationService(this.db).notifyAgent(mandate.ownerId, {
      title: "UPI mandate removed",
      message:
        "Your UPI autopay mandate was removed. Your plan won't renew; it stops on its end date. Take a new subscription in the app to set up a new mandate.",
      kind: NotificationKind.MANDATE_REVOKED,
      type: NotificationType.WARNING,
      data: { subscriptionId: mandate.subscriptionId, mandateId: mandate.id },
    });

    return updated;
  }

  async mandateActivated(mandateId: string) {
    return this.db.subscriptionMandate.updateMany({
      where: { id: mandateId, status: MandateStatus.PENDING },
      data: { status: MandateStatus.ACTIVE, activatedAt: new Date() },
    });
  }

  /**
   * The plan's monthly price changed (super admin): the subscription renews at
   * the new price. Its running mandate is cancelled and a new one is created
   * for the new monthly amount (Razorpay: the CSP approves it in the UPI app
   * before the end date, or the renewal can't be charged and the plan stops).
   * Subscriptions that are cancelled, lapsed or not on auto renew are left
   * alone. Returns false when there was nothing to replace.
   */
  async replaceMandateForPrice(subscriptionId: string, pricePerMachine: Prisma.Decimal) {
    await this.db.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${subscriptionId} FOR UPDATE`;

    const subscription = await this.db.subscription.findUnique({ where: { id: subscriptionId } });

    if (
      !subscription ||
      subscription.status !== SubscriptionStatus.ACTIVE ||
      !renewsByMandate(subscription) ||
      (subscription.pricePerMachine !== null && D(subscription.pricePerMachine).equals(pricePerMachine))
    ) {
      return false;
    }

    const previous = await this.db.subscriptionMandate.findFirst({
      where: { subscriptionId, status: { in: [MandateStatus.ACTIVE, MandateStatus.PENDING] } },
      orderBy: { createdAt: "desc" },
    });

    const updated = await this.db.subscription.update({
      where: { id: subscriptionId },
      data: { pricePerMachine },
    });

    // New mandate first: if the gateway refuses it, the old one keeps working.
    const mandate = await this.createMandate(updated);

    await this.cancelMandates(subscriptionId, MandateStatus.REPLACED, "Plan price changed.", mandate.id);

    await new NotificationService(this.db).notifyAgent(updated.ownerId, {
      title: "New UPI mandate for your plan",
      message:
        mandate.status === MandateStatus.ACTIVE
          ? `The plan price changed. Your old UPI mandate${previous ? ` (₹${previous.amount.toFixed(2)}/month)` : ""} is cancelled and a new one for ₹${mandate.amount.toFixed(2)}/month (incl. GST) is set up. It's charged from your next renewal on ${updated.endDate.toISOString()}.`
          : `The plan price changed. Your old UPI mandate${previous ? ` (₹${previous.amount.toFixed(2)}/month)` : ""} is cancelled. Approve the new mandate for ₹${mandate.amount.toFixed(2)}/month (incl. GST) in your UPI app before ${updated.endDate.toISOString()}, or your plan won't renew.`,
      kind: NotificationKind.MANDATE_REPLACED,
      type: mandate.status === MandateStatus.ACTIVE ? NotificationType.INFO : NotificationType.WARNING,
      data: {
        subscriptionId,
        mandateId: mandate.id,
        previousMandateId: previous?.id ?? null,
        previousAmount: previous?.amount.toFixed(2) ?? null,
        amount: mandate.amount.toFixed(2),
        status: mandate.status,
        authUrl: mandate.authUrl,
        nextChargeAt: updated.endDate.toISOString(),
      },
    });

    return true;
  }

  // ---------------------------------------------------------------------------

  private async cancelMandates(subscriptionId: string, status: MandateStatus, reason?: string, keepId?: string) {
    const mandates = await this.db.subscriptionMandate.findMany({
      where: {
        subscriptionId,
        status: { in: [MandateStatus.ACTIVE, MandateStatus.PENDING] },
        ...(keepId && { id: { not: keepId } }),
      },
    });

    for (const mandate of mandates) {
      await getMandateGateway(mandate.provider).cancel(mandate);
    }

    await this.db.subscriptionMandate.updateMany({
      where: { id: { in: mandates.map((mandate) => mandate.id) } },
      data: { status, cancelledAt: new Date(), ...(reason && { revokeReason: reason }) },
    });
  }

  private async updateMandateAmount(subscription: Subscription) {
    const mandate = await this.db.subscriptionMandate.findFirst({
      where: { subscriptionId: subscription.id, status: { in: [MandateStatus.ACTIVE, MandateStatus.PENDING] } },
      orderBy: { createdAt: "desc" },
    });

    if (!mandate) {
      return;
    }

    const amount = await this.monthlyAmount(subscription);
    const { applied } = await getMandateGateway(mandate.provider).updateAmount(mandate, Number(amount));

    await this.db.subscriptionMandate.update({
      where: { id: mandate.id },
      data: { amount, amountChangePending: !applied },
    });
  }

  /** Monthly mandate amount (incl. GST). */
  private async monthlyAmount(subscription: Subscription) {
    const unit =
      subscription.pricePerMachine !== null
        ? D(subscription.pricePerMachine)
        : await this.currentUnitPrice(subscription.planId, BillingCycle.MONTHLY);

    const { totalAmount } = await new BillingSettingsService(this.db).withGst(
      Number(unit.times(subscription.machineLimit)),
    );

    return totalAmount;
  }

  private async currentUnitPrice(planId: string, billingCycle: BillingCycle) {
    const pricing = await this.db.planPricing.findUnique({
      where: { planId_billingCycle: { planId, billingCycle } },
    });

    if (!pricing) {
      throw new BadRequestError("The plan's price for this billing cycle is missing.");
    }

    return D(pricing.price);
  }

}
