import { PrismaDb } from "../../../core/database/prisma.types";
import { CurrentUser } from "../../../core/types/auth.types";
import { Subscription } from "../../../generated/prisma/client";
import {
  MandateStatus,
  SubscriptionOwnerType,
  SubscriptionType,
  UserRole,
} from "../../../generated/prisma/enums";
import { DesktopFeature } from "../subscription-entitlement.service";
import SubscriptionEntitlementService from "../subscription-entitlement.service";
import SubscriptionRepository from "../subscription.repository";

import { RENEWAL_MAX_ATTEMPTS, UPGRADE_WINDOW_DAYS } from "./billing.constants";
import { isRenewalPending, isRunning, upgradeWindowEndsAt } from "./subscription-billing.service";

/** App screens a CSP plan opens (mobile). */
export type AppScreen = "dashboard" | "machines" | "cash" | "reports";

export const SUBSCRIPTION_REQUIRED_MESSAGE = "Please renew or take a new plan.";
export const PLAN_UPGRADE_MESSAGE = "Please upgrade the plan to use this.";
export const RENEWAL_PENDING_MESSAGE =
  "Your plan's renewal payment is being charged through your UPI mandate. Services resume as soon as it goes through.";

/**
 * - NONE: never subscribed
 * - ACTIVE: running, renews by mandate
 * - CANCELLED: running until its end date, won't renew
 * - RENEWAL_PENDING: end date passed, the mandate charge is being tried
 *   (blocked until it succeeds; stops for good after the 3rd failure)
 * - LAPSED: renewal failed after every retry (stopped at once)
 * - EXPIRED: ended (cancelled, or no mandate)
 */
export type SubscriptionState =
  | "NONE"
  | "ACTIVE"
  | "CANCELLED"
  | "RENEWAL_PENDING"
  | "LAPSED"
  | "EXPIRED";

/**
 * What a CSP's plan opens in the app and on the desktop. Without a running
 * subscription only KO management, payments, plan history and subscribing
 * stay open. CSP Automation (₹250) opens the desktop automation only; the
 * app's dashboard, machines, cash and reports need the Complete plan
 * (MOBILE_TRACKING; cash also CASH_MANAGEMENT). BC and super admin users
 * aren't gated here.
 */
export default class SubscriptionAccessStateService {
  constructor(private readonly db: PrismaDb) {}

  async forUser(user: CurrentUser) {
    if (user.role !== UserRole.CSP_ADMIN) {
      return {
        gated: false as const,
        state: null,
        usable: true,
        blocked: false,
        blockReason: null,
        message: null,
        screens: allScreens(true),
        alwaysOpen: ALWAYS_OPEN,
        desktop: { automation: true, cashManagement: true },
        subscription: null,
        renewal: null,
        upgrade: null,
        cancel: null,
      };
    }

    return this.forCsp(user.agentId);
  }

  async forCsp(cspAgentId: string) {
    const latest = await this.latestOf(cspAgentId);
    const usable = !!latest && isRunning(latest);
    const features = latest && usable
      ? new Set(
          (await new SubscriptionEntitlementService(this.db).getPlanEntitlements(latest.planId)).features.map(
            (feature) => feature.code,
          ),
        )
      : new Set<string>();

    const mobile = features.has(DesktopFeature.MOBILE_TRACKING);
    const cash = features.has(DesktopFeature.CASH_MANAGEMENT);

    const screens: Record<AppScreen, boolean> = {
      dashboard: usable && mobile,
      machines: usable && mobile,
      cash: usable && mobile && cash,
      reports: usable && mobile,
    };

    const renewalPending = !!latest && isRenewalPending(latest);

    const blockReason = renewalPending
      ? ("RENEWAL_PENDING" as const)
      : !usable
      ? ("SUBSCRIPTION_REQUIRED" as const)
      : Object.values(screens).some((open) => !open)
        ? ("PLAN_UPGRADE_REQUIRED" as const)
        : null;

    const mandate = latest
      ? await this.db.subscriptionMandate.findFirst({
          where: { subscriptionId: latest.id },
          orderBy: { createdAt: "desc" },
        })
      : null;

    const plan = latest ? await this.db.plan.findUnique({ where: { id: latest.planId } }) : null;
    const now = new Date();
    const windowEndsAt = latest ? upgradeWindowEndsAt(latest) : null;
    const isTrial = latest?.subscriptionType === SubscriptionType.TRIAL;
    // On a trial the CSP buys a plan instead (a purchase replaces the trial).
    const upgradeOpen =
      usable && !isTrial && !latest!.cancelledAt && !!windowEndsAt && windowEndsAt.getTime() >= now.getTime();

    return {
      gated: true as const,
      state: renewalPending ? ("RENEWAL_PENDING" as const) : stateOf(latest, usable),
      usable,
      // The app shows a non-closable "renew or take a new plan" popup.
      blocked: !usable,
      blockReason,
      message:
        blockReason === "RENEWAL_PENDING"
          ? RENEWAL_PENDING_MESSAGE
          : blockReason === "SUBSCRIPTION_REQUIRED"
          ? SUBSCRIPTION_REQUIRED_MESSAGE
          : blockReason === "PLAN_UPGRADE_REQUIRED"
            ? PLAN_UPGRADE_MESSAGE
            : null,
      screens,
      alwaysOpen: ALWAYS_OPEN,
      desktop: {
        automation: usable && features.has(DesktopFeature.AUTOMATION),
        cashManagement: usable && cash,
      },
      subscription: latest
        ? {
            id: latest.id,
            subscriptionNumber: latest.subscriptionNumber,
            status: latest.status,
            subscriptionType: latest.subscriptionType,
            planId: latest.planId,
            planCode: plan?.code ?? null,
            planName: plan?.name ?? null,
            planLevel: plan?.level ?? null,
            machineLimit: latest.machineLimit,
            pricePerMachine: latest.pricePerMachine?.toFixed(2) ?? null,
            startDate: latest.startDate,
            currentPeriodStart: latest.currentPeriodStart ?? latest.startDate,
            endDate: latest.endDate,
            graceEndsAt: latest.graceEndsAt,
            features: [...features],
          }
        : null,
      // Free trial (null when the latest subscription isn't one).
      trial:
        latest && isTrial
          ? {
              active: usable,
              endsAt: latest.endDate,
              daysLeft: usable ? Math.ceil((latest.endDate.getTime() - now.getTime()) / 86_400_000) : 0,
              machineLimit: latest.machineLimit,
            }
          : null,
      renewal: latest
        ? {
            autoRenew: latest.autoRenew && !latest.cancelledAt && !latest.lapsedAt,
            nextChargeAt: latest.autoRenew && !latest.cancelledAt && !latest.lapsedAt
              ? (latest.nextRenewalAttemptAt ?? latest.endDate)
              : null,
            attempts: latest.renewalAttempts,
            maxAttempts: RENEWAL_MAX_ATTEMPTS,
            lastFailure: latest.lastRenewalFailure,
            lapsedAt: latest.lapsedAt,
            mandate: mandate
              ? {
                  id: mandate.id,
                  status: mandate.status,
                  provider: mandate.provider,
                  amount: mandate.amount.toFixed(2),
                  amountChangePending: mandate.amountChangePending,
                  authUrl: mandate.status === MandateStatus.PENDING ? mandate.authUrl : null,
                  endAt: mandate.endAt,
                }
              : null,
          }
        : null,
      upgrade: {
        allowed: upgradeOpen,
        windowDays: UPGRADE_WINDOW_DAYS,
        windowEndsAt: usable ? windowEndsAt : null,
        // Plans can't be downgraded and machines can't be reduced.
        minPlanLevel: plan?.level ?? null,
        minMachineCount: usable ? latest!.machineLimit : null,
        reason: !usable
          ? "NO_RUNNING_SUBSCRIPTION"
          : isTrial
            ? "TRIAL"
          : latest!.cancelledAt
            ? "CANCELLED"
            : upgradeOpen
              ? null
              : "UPGRADE_WINDOW_CLOSED",
      },
      cancel: {
        // Also while the renewal is being charged: stops the retries, ends now.
        allowed: (usable || renewalPending) && !isTrial && !latest!.cancelledAt,
        cancelledAt: latest?.cancelledAt ?? null,
        // Works until this date after a cancel; no refund.
        usableUntil: latest?.cancelledAt ? latest.endDate : null,
      },
    };
  }

  /** Whether the CSP's plan opens a screen (route gate). */
  async canOpen(cspAgentId: string, screen: AppScreen) {
    const state = await this.forCsp(cspAgentId);

    return { open: state.screens[screen], usable: state.usable, blockReason: state.blockReason, message: state.message };
  }

  private latestOf(cspAgentId: string): Promise<Subscription | null> {
    return new SubscriptionRepository(this.db).findLatestSubscription(SubscriptionOwnerType.CSP, cspAgentId);
  }
}

const ALWAYS_OPEN = ["koManagement", "payments", "planHistory", "subscribe", "renew", "cancel", "notifications", "profile"];

function allScreens(value: boolean): Record<AppScreen, boolean> {
  return { dashboard: value, machines: value, cash: value, reports: value };
}

function stateOf(latest: Subscription | null, usable: boolean): SubscriptionState {
  if (!latest) {
    return "NONE";
  }

  if (latest.lapsedAt && !usable) {
    return "LAPSED";
  }

  if (!usable) {
    return "EXPIRED";
  }

  return latest.cancelledAt ? "CANCELLED" : "ACTIVE";
}
