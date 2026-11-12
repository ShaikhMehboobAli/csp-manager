import { PrismaDb } from "../../../core/database/prisma.types";
import { BadRequestError } from "../../../core/errors/BadRequestError";
import { ConflictError } from "../../../core/errors/ConflictError";
import { ForbiddenError } from "../../../core/errors/ForbiddenError";
import { NotFoundError } from "../../../core/errors/NotFoundError";
import { createCodeGeneratorService } from "../../../core/services/service.factory";
import { CurrentUser } from "../../../core/types/auth.types";
import { Prisma, Subscription } from "../../../generated/prisma/client";
import {
  NotificationKind,
  NotificationType,
  SubscriptionCreatedSource,
  SubscriptionEventType,
  SubscriptionOwnerType,
  SubscriptionStatus,
  SubscriptionType,
  TrialIdentityKind,
  UserRole,
} from "../../../generated/prisma/enums";
import ActivationRepository from "../../activations/activation.repository";
import ActivationService from "../../activations/activation.service";
import NotificationService from "../../notifications/notification.service";
import { mapSubscription } from "../mappers/subscription.mapper";
import SubscriptionRepository from "../subscription.repository";

import { IDENTITY_LABEL, identities, TrialIdentity } from "./trial-identity";
import TrialSettingsService, { MAX_TRIAL_MACHINES } from "./trial-settings.service";

const DAY_MS = 24 * 60 * 60 * 1000;

export type TrialUnavailableReason = "TRIAL_DISABLED" | "HAS_SUBSCRIPTION" | "TRIAL_ALREADY_USED" | "NOT_AN_OWNER";

function ownerTypeOf(user: CurrentUser) {
  if (user.role === UserRole.CSP_ADMIN) {
    return SubscriptionOwnerType.CSP;
  }

  if (user.role === UserRole.BC_ADMIN) {
    return SubscriptionOwnerType.BC;
  }

  return null;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Free trial: a new CSP / BC account (no subscription ever) starts one trial
 * from the app. It gets the full plan (CSP Complete / the BC plan set by the
 * super admin) for the trial days, CSP: the trial's activation codes.
 *
 * One trial per person and per PC: the owner's SBI agent ID, mobile and email
 * are written to `TrialUsage` when the trial starts, and each PC fingerprint
 * (and the agent activating it) when it is activated under a trial. A new
 * account matching any of them can't take a trial, and a PC that ran a trial
 * can't be activated under another account's trial. The rows outlive
 * accounts, subscriptions and machines.
 */
export default class TrialService {
  constructor(private readonly db: PrismaDb) {}

  /** What the app shows before "Start free trial". */
  async status(user: CurrentUser) {
    const settings = await new TrialSettingsService(this.db).get();
    const ownerType = ownerTypeOf(user);
    const plan = ownerType
      ? await this.db.plan.findUnique({
          where: { code: ownerType === SubscriptionOwnerType.CSP ? settings.cspPlanCode : settings.bcPlanCode },
        })
      : null;

    const trial = ownerType
      ? await this.db.subscription.findFirst({
          where: { ownerType, ownerId: user.agentId, subscriptionType: SubscriptionType.TRIAL },
          orderBy: { createdAt: "desc" },
        })
      : null;

    const reason = ownerType ? await this.unavailableReason(ownerType, user.agentId, settings.enabled) : "NOT_AN_OWNER";

    return {
      enabled: settings.enabled,
      available: reason === null,
      reason,
      days: settings.days,
      machineCount: ownerType === SubscriptionOwnerType.CSP ? settings.machineCount : (plan?.machineLimit ?? 0),
      plan: plan ? { code: plan.code, name: plan.name } : null,
      trial: trial ? this.summary(trial) : null,
    };
  }

  /** POST /subscriptions/trial/start */
  async start(user: CurrentUser) {
    const ownerType = ownerTypeOf(user);

    if (!ownerType) {
      throw new ForbiddenError("Only a CSP or BC account can start a free trial.", "TRIAL_NOT_AVAILABLE");
    }

    const settings = await new TrialSettingsService(this.db).get({ fresh: true });

    // One start at a time per account.
    await this.db.$queryRaw`SELECT id FROM "Agent" WHERE "agentId" = ${user.agentId} FOR UPDATE`;

    const reason = await this.unavailableReason(ownerType, user.agentId, settings.enabled);

    if (reason === "TRIAL_DISABLED") {
      throw new ForbiddenError("Free trials aren't available right now.", "TRIAL_DISABLED");
    }

    if (reason === "HAS_SUBSCRIPTION") {
      throw new ConflictError(
        "The free trial is only for new accounts. This account already has (or had) a plan.",
        "TRIAL_NOT_AVAILABLE",
      );
    }

    const owner = await this.ownerIdentities(user.agentId);
    const used = await this.findUsed(owner, user.agentId);

    if (used) {
      throw this.alreadyUsed(used.kind);
    }

    const plan = await this.db.plan.findUnique({
      where: { code: ownerType === SubscriptionOwnerType.CSP ? settings.cspPlanCode : settings.bcPlanCode },
    });

    if (!plan || plan.isDeleted || !plan.isActive) {
      throw new BadRequestError("The free trial plan isn't available. Please contact support.", "TRIAL_PLAN_INVALID");
    }

    const now = new Date();
    const endDate = new Date(now.getTime() + settings.days * DAY_MS);
    const machineLimit = ownerType === SubscriptionOwnerType.CSP ? settings.machineCount : (plan.machineLimit ?? 0);

    const subscription = await this.db.subscription.create({
      data: {
        subscriptionNumber: await createCodeGeneratorService(this.db).generateSubscriptionNumber(),
        ownerType,
        ownerId: user.agentId,
        planId: plan.id,
        machineLimit,
        amountPaid: 0,
        startDate: now,
        endDate,
        currentPeriodStart: now,
        graceEndsAt: null,
        subscriptionType: SubscriptionType.TRIAL,
        status: SubscriptionStatus.ACTIVE,
        // Never renews by itself: the owner buys a plan.
        autoRenew: false,
        createdSource: SubscriptionCreatedSource.SELF,
        createdBy: user.userId,
      },
    });

    await this.record(owner, subscription, user.agentId);

    const activations = await new ActivationService().generateActivations(
      { subscriptionId: subscription.id, machineLimit, expiresAt: endDate },
      this.db,
    );

    await new SubscriptionRepository(this.db).createHistory({
      subscriptionId: subscription.id,
      eventType: SubscriptionEventType.TRIAL_STARTED,
      newPlanId: plan.id,
      amount: 0,
      remarks: `Free trial: ${settings.days} days, ${machineLimit} machine(s).`,
    });

    await new NotificationService(this.db).notifyAgent(user.agentId, {
      title: "Free trial started",
      message: `Your ${settings.days}-day free trial of ${plan.name} has started. It ends on ${endDate.toISOString()}. Buy a plan before then to keep using CSP Manager.`,
      kind: NotificationKind.TRIAL_STARTED,
      type: NotificationType.SUCCESS,
      data: { subscriptionId: subscription.id, endDate: endDate.toISOString() },
    });

    return {
      subscription: mapSubscription({ ...subscription, plan, payments: [] }),
      trial: this.summary(subscription),
      activations: activations.map(({ activation }) => ({
        activationCode: activation.activationCode,
        expiresAt: activation.expiresAt,
      })),
    };
  }

  /**
   * Machine activation under a trial: the PC and the activating agent must
   * not have been part of another account's trial. Writes them to the
   * registry (inside the activation's transaction).
   */
  async claimMachine(input: { subscription: Subscription; fingerprint: string; agentId: string }) {
    if (input.subscription.subscriptionType !== SubscriptionType.TRIAL) {
      return;
    }

    const wanted = identities([
      [TrialIdentityKind.MACHINE_FINGERPRINT, input.fingerprint],
      [TrialIdentityKind.AGENT_ID, input.agentId],
    ]);

    const used = await this.findUsed(wanted, input.subscription.ownerId);

    if (used) {
      throw used.kind === TrialIdentityKind.MACHINE_FINGERPRINT
        ? new ConflictError(
            "This PC has already been used for a free trial. Buy a plan to activate it.",
            "TRIAL_ALREADY_USED_ON_MACHINE",
          )
        : new ConflictError(
            "This SBI agent ID has already been used for a free trial. Buy a plan to activate it.",
            "TRIAL_ALREADY_USED",
          );
    }

    await this.record(wanted, input.subscription, input.agentId, "machine");
  }

  // ---------------------------------------------------------------------------
  // Super admin
  // ---------------------------------------------------------------------------

  async list(query: { status?: "ACTIVE" | "EXPIRED"; search?: string; page: number; limit: number }) {
    const where: Prisma.SubscriptionWhereInput = {
      subscriptionType: SubscriptionType.TRIAL,
      ...(query.status && { status: query.status }),
      ...(query.search && {
        OR: [
          { ownerId: { contains: query.search, mode: "insensitive" } },
          { subscriptionNumber: { contains: query.search, mode: "insensitive" } },
        ],
      }),
    };

    const [total, rows] = await Promise.all([
      this.db.subscription.count({ where }),
      this.db.subscription.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { plan: { select: { code: true, name: true } } },
      }),
    ]);

    const ownerIds = [...new Set(rows.map((row) => row.ownerId))];
    const [agents, paid, activated] = await Promise.all([
      this.db.agent.findMany({
        where: { agentId: { in: ownerIds } },
        select: { agentId: true, name: true, mobile: true, email: true, type: true },
      }),
      this.db.subscription.findMany({
        where: { ownerId: { in: ownerIds }, subscriptionType: { not: SubscriptionType.TRIAL } },
        select: { ownerId: true },
      }),
      this.db.activation.groupBy({
        by: ["subscriptionId"],
        where: { subscriptionId: { in: rows.map((row) => row.id) }, status: "ACTIVE" },
        _count: { _all: true },
      }),
    ]);

    const agentOf = new Map(agents.map((agent) => [agent.agentId, agent]));
    const converted = new Set(paid.map((row) => row.ownerId));
    const activeOf = new Map(activated.map((row) => [row.subscriptionId, row._count._all]));

    return {
      total,
      page: query.page,
      limit: query.limit,
      items: rows.map((row) => ({
        ...this.summary(row),
        subscriptionNumber: row.subscriptionNumber,
        status: row.status,
        ownerType: row.ownerType,
        owner: agentOf.get(row.ownerId) ?? { agentId: row.ownerId },
        plan: row.plan,
        machinesActivated: activeOf.get(row.id) ?? 0,
        // Bought a plan after the trial.
        converted: converted.has(row.ownerId),
      })),
    };
  }

  /**
   * Extend a trial (more days and / or more machines). An ended trial comes
   * back unless the owner has bought a plan since.
   */
  async extend(subscriptionId: string, input: { extendDays?: number; machineCount?: number }, adminUserId: string) {
    await this.db.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${subscriptionId} FOR UPDATE`;

    const trial = await this.db.subscription.findUnique({ where: { id: subscriptionId } });

    if (!trial || trial.subscriptionType !== SubscriptionType.TRIAL) {
      throw new NotFoundError("Trial not found.");
    }

    const latest = await new SubscriptionRepository(this.db).findLatestSubscription(trial.ownerType, trial.ownerId);

    if (latest && latest.id !== trial.id) {
      throw new ConflictError("This owner has bought a plan since the trial; it can't be extended.", "TRIAL_CONVERTED");
    }

    if (trial.status !== SubscriptionStatus.ACTIVE && trial.status !== SubscriptionStatus.EXPIRED) {
      throw new BadRequestError(`A ${trial.status.toLowerCase()} trial can't be extended.`);
    }

    if (input.machineCount !== undefined && input.machineCount < trial.machineLimit) {
      throw new BadRequestError(
        `Machines can't be reduced (${trial.machineLimit} now).`,
        "TRIAL_MACHINE_DECREASE",
      );
    }

    if (input.machineCount !== undefined && input.machineCount > MAX_TRIAL_MACHINES) {
      throw new BadRequestError(`At most ${MAX_TRIAL_MACHINES} machines.`);
    }

    const now = new Date();
    const endDate = input.extendDays
      ? new Date(Math.max(trial.endDate.getTime(), now.getTime()) + input.extendDays * DAY_MS)
      : trial.endDate;

    if (endDate < now) {
      throw new BadRequestError("This trial has ended. Add days to bring it back.", "TRIAL_ENDED");
    }

    const updated = await this.db.subscription.update({
      where: { id: trial.id },
      data: {
        endDate,
        status: SubscriptionStatus.ACTIVE,
        machineLimit: input.machineCount ?? trial.machineLimit,
        ...(input.extendDays && { trialReminderSentAt: null }),
        updatedBy: adminUserId,
      },
    });

    await new ActivationRepository(this.db).updateSubscriptionActivationExpiry(updated.id, endDate);

    await new ActivationService().generateActivations(
      { subscriptionId: updated.id, machineLimit: updated.machineLimit, expiresAt: endDate },
      this.db,
    );

    const changes = [
      input.extendDays ? `+${input.extendDays} days (ends ${endDate.toISOString()})` : null,
      input.machineCount !== undefined && input.machineCount !== trial.machineLimit
        ? `machines ${trial.machineLimit} → ${input.machineCount}`
        : null,
    ].filter(Boolean);

    await new SubscriptionRepository(this.db).createHistory({
      subscriptionId: updated.id,
      eventType: SubscriptionEventType.TRIAL_EXTENDED,
      previousPlanId: updated.planId,
      newPlanId: updated.planId,
      amount: 0,
      remarks: `Extended by the super admin: ${changes.join(", ") || "no change"}.`,
    });

    await new NotificationService(this.db).notifyAgent(updated.ownerId, {
      title: "Free trial extended",
      message: `Your free trial was extended: ${changes.join(", ")}.`,
      kind: NotificationKind.TRIAL_EXTENDED,
      type: NotificationType.SUCCESS,
      data: { subscriptionId: updated.id, endDate: endDate.toISOString(), machineLimit: updated.machineLimit },
    });

    return { ...this.summary(updated), subscriptionNumber: updated.subscriptionNumber, status: updated.status };
  }

  async listUsages(query: { ownerId?: string; value?: string; page: number; limit: number }) {
    const where: Prisma.TrialUsageWhereInput = {
      ...(query.ownerId && { ownerId: query.ownerId }),
      ...(query.value && { value: { contains: query.value.trim(), mode: "insensitive" } }),
    };

    const [total, items] = await Promise.all([
      this.db.trialUsage.count({ where }),
      this.db.trialUsage.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return { total, page: query.page, limit: query.limit, items };
  }

  /** Support: lets this identity take part in a trial again. */
  async deleteUsage(id: string) {
    const usage = await this.db.trialUsage.findUnique({ where: { id } });

    if (!usage) {
      throw new NotFoundError("Trial usage not found.");
    }

    await this.db.trialUsage.delete({ where: { id } });

    return usage;
  }

  /** Hourly: "your trial ends soon" about a day before. */
  async sendEndingReminders(now = new Date()) {
    const due = await this.db.subscription.findMany({
      where: {
        subscriptionType: SubscriptionType.TRIAL,
        status: SubscriptionStatus.ACTIVE,
        trialReminderSentAt: null,
        endDate: { gt: now, lte: new Date(now.getTime() + DAY_MS) },
      },
      take: 200,
    });

    for (const trial of due) {
      await new NotificationService(this.db).notifyAgent(trial.ownerId, {
        title: "Free trial ends soon",
        message: `Your free trial ends on ${trial.endDate.toISOString()}. Buy a plan to keep your PCs and data working without a break.`,
        kind: NotificationKind.TRIAL_ENDING,
        type: NotificationType.WARNING,
        data: { subscriptionId: trial.id, endDate: trial.endDate.toISOString() },
      });

      await this.db.subscription.update({ where: { id: trial.id }, data: { trialReminderSentAt: now } });
    }

    return due.length;
  }

  // ---------------------------------------------------------------------------

  summary(subscription: Subscription) {
    const now = Date.now();
    const running = subscription.status === SubscriptionStatus.ACTIVE && subscription.endDate.getTime() >= now;

    return {
      subscriptionId: subscription.id,
      active: running,
      startDate: subscription.startDate,
      endsAt: subscription.endDate,
      daysLeft: running ? Math.ceil((subscription.endDate.getTime() - now) / DAY_MS) : 0,
      machineLimit: subscription.machineLimit,
    };
  }

  private async unavailableReason(
    ownerType: SubscriptionOwnerType,
    agentId: string,
    enabled: boolean,
  ): Promise<TrialUnavailableReason | null> {
    if (!enabled) {
      return "TRIAL_DISABLED";
    }

    const subscriptions = await this.db.subscription.count({ where: { ownerType, ownerId: agentId } });

    if (subscriptions > 0) {
      return "HAS_SUBSCRIPTION";
    }

    const used = await this.findUsed(await this.ownerIdentities(agentId), agentId);

    return used ? "TRIAL_ALREADY_USED" : null;
  }

  private async ownerIdentities(agentId: string) {
    const [user, agent] = await Promise.all([
      this.db.user.findUnique({ where: { agentId }, select: { email: true } }),
      this.db.agent.findUnique({ where: { agentId }, select: { email: true, mobile: true } }),
    ]);

    return identities([
      [TrialIdentityKind.AGENT_ID, agentId],
      [TrialIdentityKind.EMAIL, user?.email],
      [TrialIdentityKind.EMAIL, agent?.email],
      [TrialIdentityKind.PHONE, agent?.mobile],
    ]);
  }

  /** A registry row for any of these identities written for another owner. */
  private async findUsed(wanted: TrialIdentity[], ownerId: string) {
    if (wanted.length === 0) {
      return null;
    }

    return this.db.trialUsage.findFirst({
      where: {
        ownerId: { not: ownerId },
        OR: wanted.map((identity) => ({ kind: identity.kind, value: identity.value })),
      },
    });
  }

  /**
   * Writes the identities (already ours → kept). A concurrent trial of
   * another account that wrote the same identity first wins: we fail.
   */
  private async record(wanted: TrialIdentity[], subscription: Subscription, agentId: string, source: "owner" | "machine" = "owner") {
    try {
      await this.db.trialUsage.createMany({
        data: wanted.map((identity) => ({
          kind: identity.kind,
          value: identity.value,
          subscriptionId: subscription.id,
          ownerType: subscription.ownerType,
          ownerId: subscription.ownerId,
          agentId,
        })),
        skipDuplicates: true,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw this.alreadyUsed(wanted[0].kind);
      }

      throw error;
    }

    const clash = await this.findUsed(wanted, subscription.ownerId);

    if (clash) {
      throw source === "machine" && clash.kind === TrialIdentityKind.MACHINE_FINGERPRINT
        ? new ConflictError(
            "This PC has already been used for a free trial. Buy a plan to activate it.",
            "TRIAL_ALREADY_USED_ON_MACHINE",
          )
        : this.alreadyUsed(clash.kind);
    }
  }

  private alreadyUsed(kind: TrialIdentityKind) {
    return new ConflictError(
      `A free trial has already been used with this ${IDENTITY_LABEL[kind]}. Please buy a plan.`,
      "TRIAL_ALREADY_USED",
    );
  }
}
