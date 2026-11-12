import { PrismaDb } from "../../core/database/prisma.types";
import { istCalendarDate, startOfIstDay } from "../../core/utils/ist";
import { AgentType, NotificationKind, NotificationType } from "../../generated/prisma/enums";
import CashRepository from "../cash/cash.repository";
import NotificationService from "../notifications/notification.service";
import SubscriptionEntitlementService from "../subscriptions/subscription-entitlement.service";
import SubscriptionAccessValidator from "../subscriptions/subscription-validator/subscription-access-validator";
import SubscriptionResolver from "../subscriptions/subscription-validator/subscription-resolver.service";

import { atIstTime, istTime } from "./alert-time.helper";

/** Closing time when the CSP set none (team settings `workdayEnd`). */
export const DEFAULT_CLOSE_TIME = "18:00";

/** How long before the CSP's closing time the reminder starts. */
export const REMIND_BEFORE_CLOSE_MINUTES = 30;

/**
 * When today's "close the day" reminder starts for a CSP's team: 30 min
 * before its closing time, or at 18:00 IST when it set none.
 */
export function reminderTimes(now: Date, workdayEnd: string | null) {
  const closeBy = atIstTime(now, workdayEnd ?? DEFAULT_CLOSE_TIME);
  const remindAt = workdayEnd ? new Date(closeBy.getTime() - REMIND_BEFORE_CLOSE_MINUTES * 60_000) : closeBy;

  return { closeBy, remindAt, closeTime: workdayEnd ?? DEFAULT_CLOSE_TIME };
}

/**
 * "Close the day" reminders: on the desktop (heartbeat `dayCloseReminder`,
 * until the agent closes) and once a day to the CSP app per agent that
 * worked today and hasn't closed.
 */
export default class DayCloseReminderService {
  constructor(private readonly db: PrismaDb) {}

  /** Heartbeat field for the agent logged in to cash on a PC; null = nothing to show. */
  async forDesktop(agentId: string | null, now = new Date()) {
    if (!agentId) {
      return null;
    }

    const cspAgentId = await new CashRepository(this.db).findPoolCspId(agentId);

    if (!cspAgentId) {
      return null;
    }

    const [pool, csp, closed] = await Promise.all([
      this.db.cashPool.findUnique({ where: { cspAgentId }, select: { cspAgentId: true } }),
      this.db.agent.findUnique({ where: { agentId: cspAgentId }, select: { workdayEnd: true } }),
      this.db.cashDayClose.findUnique({
        where: { agentId_date: { agentId, date: istCalendarDate(now) } },
        select: { id: true },
      }),
    ]);

    if (!pool || closed) {
      return null;
    }

    const { closeBy, remindAt, closeTime } = reminderTimes(now, csp?.workdayEnd ?? null);

    if (now < remindAt) {
      return null;
    }

    const late = now >= closeBy;

    return {
      closeTime,
      remindAt,
      overdue: late,
      message: late
        ? `It's past ${closeTime}. Please close the day: count your cash and close it in Cash.`
        : `Please close the day by ${closeTime}: count your cash and close it in Cash.`,
    };
  }

  /** Job: tells each CSP which of its agents worked today and haven't closed. */
  async sendAppReminders(now = new Date()) {
    const date = istCalendarDate(now);
    const dayStart = startOfIstDay(now);
    const pools = await this.db.cashPool.findMany({ select: { cspAgentId: true } });
    let sent = 0;

    for (const { cspAgentId } of pools) {
      const csp = await this.db.agent.findUnique({
        where: { agentId: cspAgentId },
        select: { workdayEnd: true, isDeleted: true },
      });

      if (!csp || csp.isDeleted) {
        continue;
      }

      const { remindAt, closeTime } = reminderTimes(now, csp.workdayEnd);

      if (now < remindAt || !(await this.hasCashPlan(cspAgentId))) {
        continue;
      }

      const agents = await this.db.agent.findMany({
        where: {
          isDeleted: false,
          OR: [{ agentId: cspAgentId }, { parentAgentId: cspAgentId, type: AgentType.KO }],
        },
        select: { agentId: true, name: true },
      });

      for (const agent of agents) {
        const [closed, reminded, worked] = await Promise.all([
          this.db.cashDayClose.findUnique({ where: { agentId_date: { agentId: agent.agentId, date } }, select: { id: true } }),
          this.db.cashDayReminder.findUnique({ where: { agentId_date: { agentId: agent.agentId, date } }, select: { id: true } }),
          this.workedToday(agent.agentId, dayStart),
        ]);

        if (closed || reminded || !worked) {
          continue;
        }

        // The unique (agentId, date) row makes this once a day, even with two API instances.
        const created = await this.db.cashDayReminder
          .create({ data: { cspAgentId, agentId: agent.agentId, date } })
          .catch(() => null);

        if (!created) {
          continue;
        }

        const self = agent.agentId === cspAgentId;
        const who = self ? "You haven't" : `${agent.name ?? agent.agentId} (${agent.agentId}) hasn't`;

        await new NotificationService(this.db).notifyAgent(cspAgentId, {
          title: "Day not closed",
          message: `${who} closed the day yet (closing time ${closeTime}). ${self ? "Close it on the desktop." : "Ask them to close it on the desktop."}`,
          kind: NotificationKind.CASH_DAY_NOT_CLOSED,
          type: NotificationType.WARNING,
          data: { agentId: agent.agentId, date: date.toISOString().slice(0, 10), closeTime, remindedAt: istTime(now) },
        });

        sent += 1;
      }
    }

    return sent;
  }

  /** Logged in on a PC (SBI kiosk) or uploaded a receipt today. */
  private async workedToday(agentId: string, dayStart: Date) {
    const [activity, receipt] = await Promise.all([
      this.db.cspActivitySession.findFirst({
        where: { agentId, OR: [{ startedAt: { gte: dayStart } }, { lastHeartbeatAt: { gte: dayStart } }] },
        select: { id: true },
      }),
      this.db.receipt.findFirst({ where: { agentId, createdAt: { gte: dayStart } }, select: { id: true } }),
    ]);

    return Boolean(activity || receipt);
  }

  private async hasCashPlan(cspAgentId: string) {
    const subscription = await new SubscriptionResolver(this.db).getEffectiveSubscription(cspAgentId);

    if (!subscription) {
      return false;
    }

    try {
      SubscriptionAccessValidator.validate(subscription);
    } catch {
      return false;
    }

    return new SubscriptionEntitlementService(this.db).canViewCashManagement(subscription);
  }
}
