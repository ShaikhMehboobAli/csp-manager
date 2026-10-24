import { PrismaDb } from "../../../core/database/prisma.types";
import { withTransaction } from "../../../core/database/transaction";
import { ConflictError } from "../../../core/errors/ConflictError";
import { ForbiddenError } from "../../../core/errors/ForbiddenError";
import { createCodeGeneratorService } from "../../../core/services/service.factory";
import {
  ActivityEndReason,
  MachineSessionStatus,
} from "../../../generated/prisma/enums";

import CspActivityRepository from "./csp-activity.repository";
import MachineAuthenticationService from "./machine-auth.service";
import MachineHeartbeatRepository from "./machine-heartbeat.repository";
import MachineRuntimeValidator from "./machine-runtime-validator";
import MachineSessionService from "./machine-session.service";
import {
  HEARTBEAT_INTERVAL_SECONDS,
  HEARTBEAT_TIMEOUT_MS,
  HEARTBEAT_TIMEOUT_SECONDS,
} from "./machine-runtime.constants";
import {
  ActivityHeartbeatRequest,
  ActivityStartRequest,
  ActivityStopRequest,
} from "./machine-runtime.validation";

type ActivitySession = Awaited<
  ReturnType<CspActivityRepository["findActiveSession"]>
>;

/**
 * CSP activity = the CSP is logged in to SBI in the desktop UI.
 *
 * - start: SBI login begins (closes any open session as REPLACED)
 * - heartbeat: every 60s; restarts transparently after a timeout (outage)
 * - stop: logout / detected auto-logout / app close
 *
 * Crashes and power loss are covered by CspActivityTimeoutJob. An activity
 * heartbeat also counts as machine liveness; the machine (service) heartbeat
 * never keeps an activity session alive.
 */
export default class CspActivityService {
  async start(request: ActivityStartRequest) {
    return withTransaction(async (tx) => {
      const authenticated = await this.authenticate(tx, request);

      if (authenticated.machine.currentAgentId !== request.agentId) {
        throw new ForbiddenError(
          "The supplied agent does not match this machine's assignment.",
        );
      }

      const repository = new CspActivityRepository(tx);

      const active = await repository.findActiveSession(
        authenticated.machine.id,
      );

      if (active) {
        await repository.closeSession(
          active,
          this.endTimeFor(active),
          isTimedOut(active)
            ? ActivityEndReason.HEARTBEAT_TIMEOUT
            : ActivityEndReason.REPLACED,
        );
      }

      const session = await this.createSession(
        tx,
        authenticated.machine.id,
        request.agentId,
      );

      await this.markMachineAlive(tx, authenticated.machine);

      return this.toResponse(session, false);
    });
  }

  async heartbeat(request: ActivityHeartbeatRequest) {
    return withTransaction(async (tx) => {
      const authenticated = await this.authenticate(tx, request);

      const repository = new CspActivityRepository(tx);

      const session = await repository.findByActivitySessionId(
        authenticated.machine.id,
        request.activitySessionId,
      );

      await this.markMachineAlive(tx, authenticated.machine);

      if (session?.status === MachineSessionStatus.ACTIVE) {
        if (!isTimedOut(session)) {
          return this.toResponse(await repository.updateHeartbeat(session.id), false);
        }

        // Missed heartbeats (e.g. internet outage): close at the last
        // heartbeat and continue in a new session.
        await repository.closeSession(
          session,
          session.lastHeartbeatAt,
          ActivityEndReason.HEARTBEAT_TIMEOUT,
        );
      } else if (
        session &&
        session.endedReason !== ActivityEndReason.HEARTBEAT_TIMEOUT
      ) {
        // Explicitly stopped or replaced: a late heartbeat must not reopen it.
        throw new ConflictError(
          "Activity session has ended. Start a new activity session.",
        );
      }

      // A retried heartbeat with the same timed-out id must not open a
      // second session: continue the machine's current live session.
      const current = await repository.findActiveSession(
        authenticated.machine.id,
      );

      if (current && !isTimedOut(current)) {
        return this.toResponse(await repository.updateHeartbeat(current.id), true);
      }

      if (current) {
        await repository.closeSession(
          current,
          current.lastHeartbeatAt,
          ActivityEndReason.HEARTBEAT_TIMEOUT,
        );
      }

      if (!authenticated.machine.currentAgentId) {
        throw new ForbiddenError(
          "No agent is currently assigned to this machine.",
        );
      }

      const restarted = await this.createSession(
        tx,
        authenticated.machine.id,
        authenticated.machine.currentAgentId,
      );

      return this.toResponse(restarted, true);
    });
  }

  async stop(request: ActivityStopRequest) {
    return withTransaction(async (tx) => {
      const authenticated = await this.authenticate(tx, request);

      const repository = new CspActivityRepository(tx);

      const session = await repository.findByActivitySessionId(
        authenticated.machine.id,
        request.activitySessionId,
      );

      // Idempotent: stopping an unknown or already-closed session succeeds.
      if (session?.status === MachineSessionStatus.ACTIVE) {
        await repository.closeSession(
          session,
          this.endTimeFor(session),
          isTimedOut(session)
            ? ActivityEndReason.HEARTBEAT_TIMEOUT
            : request.reason,
        );
      }

      return {
        activitySessionId: request.activitySessionId,
        stopped: true,
      };
    });
  }

  /**
   * Activity for one machine in [from, to]: whether a CSP is active now,
   * and total active seconds clipped to the range.
   */
  static async getActivitySummary(
    db: PrismaDb,
    machineId: string,
    from: Date,
    to: Date,
  ) {
    const sessions = await new CspActivityRepository(db).findSessionsForRange(
      machineId,
      from,
      to,
    );

    const now = new Date();

    const current = sessions.find(
      (session) =>
        session.status === MachineSessionStatus.ACTIVE && !isTimedOut(session),
    );

    const activeSeconds = sessions.reduce((total, session) => {
      const end =
        session.endedAt ?? (session === current ? now : session.lastHeartbeatAt);

      const start = Math.max(session.startedAt.getTime(), from.getTime());
      const stop = Math.min(end.getTime(), to.getTime());

      return total + Math.max(0, Math.floor((stop - start) / 1000));
    }, 0);

    return {
      isActive: Boolean(current),
      agentId: current?.agentId ?? null,
      activeSince: current?.startedAt ?? null,
      activeSeconds,
      sessions: sessions.map((session) => ({
        activitySessionId: session.activitySessionId,
        agentId: session.agentId,
        status: session.status,
        startedAt: session.startedAt,
        lastHeartbeatAt: session.lastHeartbeatAt,
        endedAt: session.endedAt,
        endedReason: session.endedReason,
        durationSeconds: session.durationSeconds,
      })),
    };
  }

  private async authenticate(
    tx: PrismaDb,
    request: { machineCode: string; apiKey: string; fingerprint: string },
  ) {
    const authenticated = await new MachineAuthenticationService(
      tx,
    ).authenticate({
      machineCode: request.machineCode,
      apiKey: request.apiKey,
      fingerprint: request.fingerprint,
    });

    MachineRuntimeValidator.validateRuntime(authenticated);

    return authenticated;
  }

  private async createSession(tx: PrismaDb, machineId: string, agentId: string) {
    const activitySessionId =
      await createCodeGeneratorService(tx).generateCspActivitySessionCode();

    return new CspActivityRepository(tx).createSession({
      activitySessionId,
      machineId,
      agentId,
    });
  }

  private async markMachineAlive(
    tx: PrismaDb,
    machine: { id: string; currentAgentId: string | null },
  ) {
    await new MachineSessionService(tx).handleHeartbeat({
      machineId: machine.id,
      currentAgentId: machine.currentAgentId,
    });

    await new MachineHeartbeatRepository(tx).markOnline(machine.id);
  }

  // A stale session ends at its last heartbeat, not at "now".
  private endTimeFor(session: NonNullable<ActivitySession>) {
    return isTimedOut(session) ? session.lastHeartbeatAt : new Date();
  }

  private toResponse(
    session: { activitySessionId: string; startedAt: Date },
    restarted: boolean,
  ) {
    return {
      activitySessionId: session.activitySessionId,
      startedAt: session.startedAt,
      restarted,
      heartbeatInterval: HEARTBEAT_INTERVAL_SECONDS,
      heartbeatTimeout: HEARTBEAT_TIMEOUT_SECONDS,
    };
  }
}

function isTimedOut(session: { lastHeartbeatAt: Date }) {
  return Date.now() - session.lastHeartbeatAt.getTime() > HEARTBEAT_TIMEOUT_MS;
}
