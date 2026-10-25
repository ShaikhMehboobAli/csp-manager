import { PrismaDb } from "../../core/database/prisma.types";
import { withReadOnly, withTransaction } from "../../core/database/transaction";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { ConflictError } from "../../core/errors/ConflictError";
import { ForbiddenError } from "../../core/errors/ForbiddenError";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { createCodeGeneratorService } from "../../core/services/service.factory";
import { CurrentUser } from "../../core/types/auth.types";
import {
  BcLinkRequestStatus,
  SubscriptionOwnerType,
  UserRole,
} from "../../generated/prisma/enums";
import { buildPagination } from "../receipts/receipt.helper";
import SubscriptionEntitlementService, {
  DesktopFeature,
} from "../subscriptions/subscription-entitlement.service";
import SubscriptionRepository from "../subscriptions/subscription.repository";
import SubscriptionAccessValidator from "../subscriptions/subscription-validator/subscription-access-validator";
import SubscriptionResolver from "../subscriptions/subscription-validator/subscription-resolver.service";

import BcLinkRepository, {
  BcLinkRequestWithRelations,
} from "./bc-link.repository";
import {
  CreateLinkRequestInput,
  ListLinkRequestsQuery,
} from "./bc-link.validation";

/**
 * BC ₹799 flow: a BC on a plan with CSP_LINKING asks to link an
 * already-subscribed CSP; SUPER_ADMIN approves or rejects. Approval sets the
 * CSP's bcId, so the BC's agent scope (dashboards, reports, receipts, ledger)
 * includes the CSP while the CSP's own subscription is active.
 */
export default class BcLinkService {
  async searchCsps(user: CurrentUser, search: string) {
    return withReadOnly(async (db) => {
      const bcId = user.agentId;

      await requireLinkingPlan(db, bcId);

      const repository = new BcLinkRepository(db);

      const csps = await repository.searchCsps(search);

      const cspIds = csps.map((csp) => csp.agentId);

      const [subscribed, pending] = await Promise.all([
        new SubscriptionRepository(db).findOwnerIdsWithActiveSubscription(
          SubscriptionOwnerType.CSP,
          cspIds,
        ),

        repository.findPendingCspIds(bcId, cspIds),
      ]);

      const pendingIds = new Set(pending.map((item) => item.cspAgentId));

      // Only already-subscribed CSPs can be linked.
      return csps
        .filter((csp) => subscribed.has(csp.agentId))
        .map((csp) => ({
          agentId: csp.agentId,
          name: csp.name,
          address: csp.address,
          linkStatus:
            csp.bcId === bcId
              ? "LINKED"
              : csp.bcId
                ? "LINKED_TO_OTHER_BC"
                : "NOT_LINKED",
          hasPendingRequest: pendingIds.has(csp.agentId),
        }));
    });
  }

  async createRequest(user: CurrentUser, input: CreateLinkRequestInput) {
    return withTransaction(async (tx) => {
      const bcId = user.agentId;

      await requireLinkingPlan(tx, bcId);

      const request = await raiseLinkRequest(tx, {
        bcId,
        cspAgentId: input.cspAgentId,
        remarks: input.remarks,
        createdByUserId: user.userId,
        cspSubscriptionRequired: true,
      });

      return mapRequest(request, user);
    });
  }

  async listRequests(user: CurrentUser, filter: ListLinkRequestsQuery) {
    return withReadOnly(async (db) => {
      const { items, total } = await new BcLinkRepository(db).list({
        ...filter,
        // A BC only ever sees its own requests.
        bcId: user.role === UserRole.SUPER_ADMIN ? filter.bcId : user.agentId,
      });

      return {
        items: items.map((item) => mapRequest(item, user)),
        pagination: buildPagination(filter.page, filter.limit, total),
      };
    });
  }

  async getRequest(user: CurrentUser, requestId: string) {
    return withReadOnly(async (db) => {
      const request = await findAccessibleRequest(db, user, requestId);

      return mapRequest(request, user);
    });
  }

  async cancelRequest(user: CurrentUser, requestId: string) {
    return withTransaction(async (tx) => {
      const request = await findAccessibleRequest(tx, user, requestId);

      ensurePending(request, "Only pending requests can be cancelled.");

      const updated = await new BcLinkRepository(tx).updateRequest(request.id, {
        status: BcLinkRequestStatus.CANCELLED,
      });

      return mapRequest(updated, user);
    });
  }

  async approveRequest(user: CurrentUser, requestId: string, remarks?: string) {
    return withTransaction(async (tx) => {
      const repository = new BcLinkRepository(tx);

      const request = await findAccessibleRequest(tx, user, requestId);

      ensurePending(request, "This request has already been reviewed.");

      const csp = await repository.findCsp(request.cspAgentId);

      if (!csp) {
        throw new BadRequestError("The CSP is no longer active.");
      }

      if (
        request.cspSubscriptionRequired &&
        !(await hasLinkingPlan(tx, request.bcId))
      ) {
        throw new BadRequestError(
          "The BC does not have an active CSP linking plan.",
        );
      }

      // Linked elsewhere at approval time (even if not when raised): moving
      // it is the admin's decision, recorded on the request.
      const linkedElsewhere = Boolean(csp.bcId) && csp.bcId !== request.bcId;

      await repository.linkCsp(
        csp.agentId,
        request.bcId,
        request.cspSubscriptionRequired,
      );

      await repository.flagPendingAsConflict(
        csp.agentId,
        request.id,
        request.bcId,
      );

      const updated = await repository.updateRequest(request.id, {
        status: BcLinkRequestStatus.APPROVED,
        isConflict: request.isConflict || linkedElsewhere,
        currentBcId: linkedElsewhere ? csp.bcId : request.currentBcId,
        reviewRemarks: remarks,
        reviewedByUserId: user.userId,
        reviewedAt: new Date(),
      });

      return mapRequest(updated, user);
    });
  }

  async rejectRequest(user: CurrentUser, requestId: string, remarks?: string) {
    return withTransaction(async (tx) => {
      const request = await findAccessibleRequest(tx, user, requestId);

      ensurePending(request, "This request has already been reviewed.");

      const updated = await new BcLinkRepository(tx).updateRequest(request.id, {
        status: BcLinkRequestStatus.REJECTED,
        reviewRemarks: remarks,
        reviewedByUserId: user.userId,
        reviewedAt: new Date(),
      });

      return mapRequest(updated, user);
    });
  }
}

/**
 * Validates and records a pending link request. Used by POST /bc-links/requests
 * and by the legacy POST /agents flow when the CSP already exists: linking an
 * existing CSP always needs SUPER_ADMIN approval.
 */
export async function raiseLinkRequest(
  db: PrismaDb,
  input: {
    bcId: string;
    cspAgentId: string;
    remarks?: string;
    createdByUserId: string;
    cspSubscriptionRequired: boolean;
  },
) {
  const repository = new BcLinkRepository(db);

  const csp = await repository.findCsp(input.cspAgentId);

  if (!csp) {
    throw new NotFoundError("CSP not found.");
  }

  if (input.cspSubscriptionRequired) {
    const subscribed = await new SubscriptionRepository(
      db,
    ).findOwnerIdsWithActiveSubscription(SubscriptionOwnerType.CSP, [
      csp.agentId,
    ]);

    if (!subscribed.has(csp.agentId)) {
      throw new BadRequestError(
        "This CSP does not have an active subscription.",
      );
    }
  }

  if (csp.bcId === input.bcId) {
    throw new BadRequestError(
      "CSP is already linked with this Business Correspondent.",
    );
  }

  if (await repository.findPendingRequest(input.bcId, csp.agentId)) {
    throw new ConflictError("A link request for this CSP is already pending.");
  }

  const requestNumber =
    await createCodeGeneratorService(db).generateBcLinkRequestNumber();

  return repository.createRequest({
    requestNumber,
    bcId: input.bcId,
    cspAgentId: csp.agentId,
    // Linked to another BC: the admin decides whether to move it.
    isConflict: Boolean(csp.bcId),
    currentBcId: csp.bcId,
    cspSubscriptionRequired: input.cspSubscriptionRequired,
    remarks: input.remarks,
    createdByUserId: input.createdByUserId,
  });
}

async function requireLinkingPlan(db: PrismaDb, bcId: string) {
  const subscription = await new SubscriptionResolver(
    db,
  ).getEffectiveSubscription(bcId);

  SubscriptionAccessValidator.validate(subscription);

  await new SubscriptionEntitlementService(db).requireFeatures(
    subscription!.planId,
    [DesktopFeature.CSP_LINKING],
  );
}

export async function hasLinkingPlan(db: PrismaDb, bcId: string) {
  try {
    await requireLinkingPlan(db, bcId);

    return true;
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return false;
    }

    throw error;
  }
}

// A BC can only reach its own requests; others are "not found".
async function findAccessibleRequest(
  db: PrismaDb,
  user: CurrentUser,
  requestId: string,
) {
  const request = await new BcLinkRepository(db).findById(requestId);

  if (
    !request ||
    (user.role !== UserRole.SUPER_ADMIN && request.bcId !== user.agentId)
  ) {
    throw new NotFoundError("Link request not found.");
  }

  return request;
}

function ensurePending(request: BcLinkRequestWithRelations, message: string) {
  if (request.status !== BcLinkRequestStatus.PENDING) {
    throw new ConflictError(message);
  }
}

export function mapRequest(
  request: BcLinkRequestWithRelations,
  user: CurrentUser,
) {
  const isAdmin = user.role === UserRole.SUPER_ADMIN;

  return {
    id: request.id,
    requestNumber: request.requestNumber,
    status: request.status,

    bcId: request.bcId,
    bcName: request.businessCorrespondent.name,

    cspAgentId: request.cspAgentId,
    cspName: request.csp.name,

    isConflict: request.isConflict,
    // SUBSCRIBED_CSP (₹799): data visible while the CSP's plan is active.
    linkType: request.cspSubscriptionRequired ? "SUBSCRIBED_CSP" : "BC_MANAGED",
    // Which other BC the CSP belongs to is only shown to the admin.
    currentBcId: isAdmin ? request.currentBcId : null,
    cspCurrentBcId: isAdmin ? request.csp.bcId : null,

    remarks: request.remarks,
    reviewRemarks: request.reviewRemarks,
    reviewedAt: request.reviewedAt,

    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}
