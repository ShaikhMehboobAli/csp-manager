import { PrismaDb } from "../../core/database/prisma.types";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { CurrentUser } from "../../core/types/auth.types";
import { ActivationStatus } from "../../generated/prisma/enums";
import { closeOpenMachineSessions } from "../machines/runtime/machine-release.helper";
import ActivationRepository from "./activation.repository";

type RevocableActivation = NonNullable<
  Awaited<ReturnType<ActivationRepository["findActivationForRevoke"]>>
>;

/** In use on a PC, or assigned to an agent but not activated yet. */
export function isRevocable(activation: RevocableActivation) {
  const isInUse =
    activation.status === ActivationStatus.ACTIVE && activation.isCurrent;

  const isAssigned =
    activation.status === ActivationStatus.NOT_ACTIVATED &&
    !!activation.assignedAgentId;

  return { isInUse, isAssigned, revocable: isInUse || isAssigned };
}

export function ensureRevocable(activation: RevocableActivation) {
  const state = isRevocable(activation);

  if (!state.revocable) {
    throw new BadRequestError(
      "Only an activation that is in use or assigned can be revoked.",
    );
  }

  return state;
}

/**
 * Revokes an activation so it can be used on another PC or by another agent.
 * A machine holding it loses its API key at once and the slot is freed. The
 * code goes back to unused and unassigned with the same expiry (no credit for
 * days already used); the owner assigns it again, which issues a new password.
 */
export async function revokeActivationRecord(
  db: PrismaDb,
  activation: RevocableActivation,
  actor: CurrentUser,
) {
  const { isInUse } = ensureRevocable(activation);

  const repository = new ActivationRepository(db);

  if (isInUse && activation.machine) {
    await closeOpenMachineSessions(db, activation.machine.id);

    await repository.releaseMachine(activation.machine.id, actor.userId);
  }

  const revoked = await repository.resetActivation(
    activation.id,
    `Revoked by ${actor.agentId} on ${new Date().toISOString()}` +
      (isInUse && activation.machine
        ? ` (released ${activation.machine.machineCode})`
        : ""),
  );

  return {
    activationId: revoked.id,
    activationCode: revoked.activationCode,
    status: revoked.status,
    expiresAt: revoked.expiresAt,
    releasedMachineCode: isInUse
      ? (activation.machine?.machineCode ?? null)
      : null,
  };
}
