import { PrismaDb } from "../../../core/database/prisma.types";
import {
  ActivityEndReason,
  SessionEndReason,
} from "../../../generated/prisma/enums";
import CspActivityRepository from "./csp-activity.repository";
import MachineSessionRepository from "./machine-session.repository";

/**
 * Closes the machine's open service and CSP activity sessions. Used when its
 * API key is replaced (re-activation) or its activation is revoked, so the
 * old install's sessions don't stay open until they time out.
 */
export async function closeOpenMachineSessions(
  db: PrismaDb,
  machineId: string,
) {
  const now = new Date();

  const machineSessions = new MachineSessionRepository(db);
  const activitySessions = new CspActivityRepository(db);

  const [session, activity] = await Promise.all([
    machineSessions.findActiveSession(machineId),
    activitySessions.findActiveSession(machineId),
  ]);

  if (session) {
    await machineSessions.closeSession(
      session.id,
      now,
      SessionEndReason.UNKNOWN,
      false,
    );
  }

  if (activity) {
    await activitySessions.closeSession(
      activity,
      now,
      ActivityEndReason.REPLACED,
    );
  }
}
