import { PrismaDb } from "../../core/database/prisma.types";
import { Prisma } from "../../generated/prisma/client";
import { NotificationKind, NotificationType } from "../../generated/prisma/enums";
import NotificationService from "../notifications/notification.service";

/**
 * Tells the CSP what one of its KOs did on the desktop. Nothing is sent when
 * the CSP did it itself (its own desktop). Informational: the KO approves its
 * own steps; the CSP doesn't act on these.
 */
export async function notifyCspOfKo(
  db: PrismaDb,
  input: {
    cspAgentId: string;
    agentId: string;
    kind: NotificationKind;
    title: string;
    /** Gets "Name (KO-ID)" for the KO. */
    message: (ko: string) => string;
    type?: NotificationType;
    data?: Record<string, Prisma.InputJsonValue | null>;
  },
) {
  if (input.agentId === input.cspAgentId) {
    return null;
  }

  const agent = await db.agent.findUnique({ where: { agentId: input.agentId }, select: { name: true } });
  const ko = agent?.name ? `${agent.name} (${input.agentId})` : input.agentId;

  return new NotificationService(db).notifyAgent(input.cspAgentId, {
    title: input.title,
    message: input.message(ko),
    kind: input.kind,
    type: input.type,
    data: { agentId: input.agentId, ...input.data } as Prisma.InputJsonValue,
  });
}
