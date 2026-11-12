import { withReadOnly, withTransaction } from "../../core/database/transaction";
import NotificationService from "../notifications/notification.service";
import { NotificationKind } from "../../generated/prisma/enums";
import { PrismaDb } from "../../core/database/prisma.types";
import { ConflictError } from "../../core/errors/ConflictError";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { createCodeGeneratorService } from "../../core/services/service.factory";
import { CurrentUser } from "../../core/types/auth.types";
import {
  ActivationRevokeRequestStatus,
  UserRole,
} from "../../generated/prisma/enums";
import { getOwnerType } from "../payments/payment.controller";
import { buildPagination } from "../receipts/receipt.helper";
import SubscriptionAccessValidator from "../subscriptions/subscription-validator/subscription-access-validator";
import SubscriptionResolver from "../subscriptions/subscription-validator/subscription-resolver.service";

import {
  ensureRevocable,
  revokeActivationRecord,
} from "./activation-revoke.helper";
import ActivationRevokeRepository, {
  ActivationRevokeRequestWithRelations,
} from "./activation-revoke.repository";
import {
  CreateRevokeRequestInput,
  ListRevokeRequestsQuery,
} from "./activation.validation";
import ActivationRepository from "./activation.repository";

/**
 * The owner (CSP / BC) asks to revoke one of its activations; SUPER_ADMIN
 * approves (the activation is revoked then) or rejects. Until approval the
 * activation keeps working.
 */
export default class ActivationRevokeService {
  async createRequest(
    user: CurrentUser,
    activationId: string,
    input: CreateRevokeRequestInput,
  ) {
    return withTransaction(async (tx) => {
      const subscription = await new SubscriptionResolver(
        tx,
      ).getEffectiveSubscription(user.agentId);

      SubscriptionAccessValidator.validate(subscription);

      const repository = new ActivationRevokeRepository(tx);

      await repository.lockActivation(activationId);

      const activation = await new ActivationRepository(
        tx,
      ).findActivationForRevoke(activationId);

      // Owners see only their own activations.
      if (
        !activation ||
        activation.subscription.ownerId !== user.agentId ||
        activation.subscription.ownerType !== getOwnerType(user.role)
      ) {
        throw new NotFoundError("Activation not found.");
      }

      const { isInUse } = ensureRevocable(activation);

      if (await repository.findPendingForActivation(activation.id)) {
        throw new ConflictError(
          "A revoke request for this activation is already pending.",
        );
      }

      const requestNumber =
        await createCodeGeneratorService(
          tx,
        ).generateActivationRevokeRequestNumber();

      const request = await repository.create({
        requestNumber,
        activationId: activation.id,
        ownerType: activation.subscription.ownerType,
        ownerId: activation.subscription.ownerId,
        machineCode: isInUse ? (activation.machine?.machineCode ?? null) : null,
        reason: input.reason,
        createdByUserId: user.userId,
      });

      await new NotificationService(tx).notifySuperAdmins({
        title: "Revoke request",
        message: `${activation.subscription.ownerId} asked to revoke ${activation.activationCode}${request.machineCode ? ` (PC ${request.machineCode})` : ""}: ${input.reason}`,
        kind: NotificationKind.ACTIVATION_REVOKE_REQUESTED,
        data: { requestId: request.id, requestNumber, activationId: activation.id, activationCode: activation.activationCode, ownerId: activation.subscription.ownerId, machineCode: request.machineCode },
      });

      return mapRevokeRequest(request);
    });
  }

  async listRequests(user: CurrentUser, filter: ListRevokeRequestsQuery) {
    return withReadOnly(async (db) => {
      const { items, total } = await new ActivationRevokeRepository(db).list({
        ...filter,
        // An owner only ever sees its own requests.
        ownerId:
          user.role === UserRole.SUPER_ADMIN ? filter.ownerId : user.agentId,
      });

      return {
        items: items.map(mapRevokeRequest),
        pagination: buildPagination(filter.page, filter.limit, total),
      };
    });
  }

  async getRequest(user: CurrentUser, requestId: string) {
    return withReadOnly(async (db) => {
      const request = await findAccessibleRequest(db, user, requestId);

      return mapRevokeRequest(request);
    });
  }

  async cancelRequest(user: CurrentUser, requestId: string) {
    return withTransaction(async (tx) => {
      const request = await findAccessibleRequest(tx, user, requestId);

      ensurePending(request, "Only pending requests can be cancelled.");

      const updated = await new ActivationRevokeRepository(tx).update(
        request.id,
        { status: ActivationRevokeRequestStatus.CANCELLED },
      );

      return mapRevokeRequest(updated);
    });
  }

  async approveRequest(user: CurrentUser, requestId: string, remarks?: string) {
    return withTransaction(async (tx) => {
      const repository = new ActivationRevokeRepository(tx);

      const request = await findAccessibleRequest(tx, user, requestId);

      await repository.lockActivation(request.activationId);

      // Re-read under the lock: a concurrent approve/cancel may have won.
      const current = await findAccessibleRequest(tx, user, requestId);

      ensurePending(current, "This request has already been reviewed.");

      const activation = await new ActivationRepository(
        tx,
      ).findActivationForRevoke(current.activationId);

      if (!activation) {
        throw new NotFoundError("Activation not found.");
      }

      // Throws if the activation changed since the request (e.g. already
      // revoked); the admin can reject the request instead.
      const revoked = await revokeActivationRecord(tx, activation, user);

      const updated = await repository.update(current.id, {
        status: ActivationRevokeRequestStatus.APPROVED,
        reviewRemarks: remarks,
        reviewedByUserId: user.userId,
        reviewedAt: new Date(),
      });

      await new NotificationService(tx).notifyAgent(current.ownerId, {
        title: "Revoke approved",
        message: `${activation.activationCode} is revoked${current.machineCode ? `; the PC ${current.machineCode} has stopped working` : ""}. Assign the code again to use it on another PC.${remarks ? ` Note: ${remarks}` : ""}`,
        kind: NotificationKind.ACTIVATION_REVOKE_APPROVED,
        data: { requestId: current.id, requestNumber: current.requestNumber, activationId: activation.id, activationCode: activation.activationCode, machineCode: current.machineCode },
      });

      return { ...mapRevokeRequest(updated), revoked };
    });
  }

  async rejectRequest(user: CurrentUser, requestId: string, remarks?: string) {
    return withTransaction(async (tx) => {
      const repository = new ActivationRevokeRepository(tx);

      const request = await findAccessibleRequest(tx, user, requestId);

      await repository.lockActivation(request.activationId);

      const current = await findAccessibleRequest(tx, user, requestId);

      ensurePending(current, "This request has already been reviewed.");

      const updated = await repository.update(current.id, {
        status: ActivationRevokeRequestStatus.REJECTED,
        reviewRemarks: remarks,
        reviewedByUserId: user.userId,
        reviewedAt: new Date(),
      });

      await new NotificationService(tx).notifyAgent(current.ownerId, {
        title: "Revoke rejected",
        message: `Your request to revoke ${current.activation.activationCode} was rejected; it keeps working.${remarks ? ` Reason: ${remarks}` : ""}`,
        kind: NotificationKind.ACTIVATION_REVOKE_REJECTED,
        data: { requestId: current.id, requestNumber: current.requestNumber, activationId: current.activationId, activationCode: current.activation.activationCode },
      });

      return mapRevokeRequest(updated);
    });
  }
}

// An owner can only reach its own requests; others are "not found".
async function findAccessibleRequest(
  db: PrismaDb,
  user: CurrentUser,
  requestId: string,
) {
  const request = await new ActivationRevokeRepository(db).findById(requestId);

  if (
    !request ||
    (user.role !== UserRole.SUPER_ADMIN && request.ownerId !== user.agentId)
  ) {
    throw new NotFoundError("Revoke request not found.");
  }

  return request;
}

function ensurePending(
  request: ActivationRevokeRequestWithRelations,
  message: string,
) {
  if (request.status !== ActivationRevokeRequestStatus.PENDING) {
    throw new ConflictError(message);
  }
}

export function mapRevokeRequest(
  request: ActivationRevokeRequestWithRelations,
) {
  return {
    id: request.id,
    requestNumber: request.requestNumber,
    status: request.status,

    activationId: request.activationId,
    activationCode: request.activation.activationCode,
    activationStatus: request.activation.status,
    assignedAgentId: request.activation.assignedAgentId,

    ownerType: request.ownerType,
    ownerId: request.ownerId,

    // Machine holding the activation when the request was raised.
    machineCode: request.machineCode,
    currentMachine: request.activation.machine,

    reason: request.reason,
    reviewRemarks: request.reviewRemarks,
    reviewedAt: request.reviewedAt,

    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}
