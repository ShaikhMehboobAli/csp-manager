import { PrismaDb } from "../../../core/database/prisma.types";
import { ConflictError } from "../../../core/errors/ConflictError";
import { TRANSACTION_OPTIONS } from "../../../core/database/transaction";
import { BadRequestError } from "../../../core/errors/BadRequestError";
import { ForbiddenError } from "../../../core/errors/ForbiddenError";
import { NotFoundError } from "../../../core/errors/NotFoundError";
import { CurrentUser } from "../../../core/types/auth.types";
import {
  Agent,
  AgentType,
  Prisma,
  PrismaClient,
  SubscriptionOwnerType,
} from "../../../generated/prisma/client";
import ActivationRepository from "../../activations/activation.repository";
import CashService from "../../cash/cash.service";
import SubscriptionAccessValidator from "../../subscriptions/subscription-validator/subscription-access-validator";
import SubscriptionResolver from "../../subscriptions/subscription-validator/subscription-resolver.service";
import SubscriptionService from "../../subscriptions/subscription.service";
import SubscriptionEntitlementService, {
  DesktopFeature,
} from "../../subscriptions/subscription-entitlement.service";
import { mapAgent } from "../mappers/agent.mapper";
import { AgentRepository } from "../repository/agent.repository";
import {
  AgentResponse,
  CreateCSPInput,
  CreateCSPResponse,
  CreateKOInput,
  CreateKOResponse,
} from "../types/service.types";
import { canManageAgent } from "../utils/agent-authorization";
import AgentScopeService from "./agent-scope.service";
import { ListAgentsDto } from "../validations/list-agents.validation";
import {
  hasLinkingPlan,
  mapRequest,
  raiseLinkRequest,
} from "../../bc-links/bc-link.service";
import { UserRole } from "../../../generated/prisma/enums";
import { UpdateAgentDto } from "../validations/update-agent.validation";

/** A new CSP brings its cash limit, cash in hand and cash in account. */
function requireNewCspCash(input: {
  openingCash?: unknown;
  openingCashInAccount?: unknown;
}) {
  const missing = [
    ["openingCash", "Cash in hand is required."],
    ["openingCashInAccount", "Cash in account is required."],
  ] as const;

  for (const [field, message] of missing) {
    if (input[field] === undefined || input[field] === null) {
      throw new BadRequestError(message);
    }
  }
}


/**
 * Whether the CSP's own plan includes cash management. A CSP on a BC
 * machine plan (no plan of its own) keeps the earlier behaviour: cash is
 * tracked.
 */
async function planHasCashManagement(db: Prisma.TransactionClient, cspAgentId: string) {
  const subscription = await new SubscriptionResolver(db).getEffectiveSubscription(cspAgentId);

  if (!subscription || subscription.ownerType !== "CSP") {
    return true;
  }

  return new SubscriptionEntitlementService(db).hasFeature(subscription.planId, "CASH_MANAGEMENT");
}

/**
 * A BC adds CSPs (and their KOs) only on a machine plan (BC_BASIC / BC_PRO).
 * The ₹799 plan (CSP_LINKING) links CSPs that pay for themselves instead.
 */
async function requireBcMachinePlan(db: Prisma.TransactionClient, bcId: string) {
  const subscription = await new SubscriptionResolver(db).getEffectiveSubscription(bcId);

  SubscriptionAccessValidator.validate(subscription);

  const linkOnly = await new SubscriptionEntitlementService(db).hasFeature(
    subscription!.planId,
    DesktopFeature.CSP_LINKING,
  );

  if (linkOnly) {
    throw new ForbiddenError(
      "Your plan links CSPs that have their own subscription; it can't create CSPs or KOs. Use Link CSP instead.",
      "PLAN_LINK_ONLY",
    );
  }
}

export class AgentService {
  //   private readonly subscriptionService: SubscriptionService;

  constructor(private readonly prisma: PrismaClient) {
    // this.agentRepository = new AgentRepository(prisma);
    // this.activationRepository = new ActivationRepository(prisma);
    // this.subscriptionService = new SubscriptionService(this.prisma);
  }

  /*  TODO we will se if we can add the subscription restriction here in fileURLToPathBuffer 
   // check for subscription and access validation
  
        const resolver = new SubscriptionResolver(tx);
  
        const subscription = await resolver.resolveForAgent(
          filter.currentAgentId,
        );
  
        SubscriptionAccessValidator.validate(subscription);
  */
  async createCSP(
    bcId: string,
    createdBy: string,
    input: CreateCSPInput,
    role: UserRole = UserRole.BC_ADMIN,
  ): Promise<CreateCSPResponse> {
    const totalRequestedMachines =
      input.machineCount +
      (input.kos?.reduce((total, ko) => total + ko.machineCount, 0) ?? 0);

    return this.prisma.$transaction(async (tx) => {
      if (role === UserRole.BC_ADMIN) {
        await requireBcMachinePlan(tx, bcId);
      }

      const activationRepository = new ActivationRepository(tx);
      const subscriptionService = new SubscriptionService(tx);

      const existingCsp = await new AgentRepository(tx).findAgentByAgentId({
        agentId: input.agentId,
      });

      // A BC linking an existing CSP needs SUPER_ADMIN approval, as in the
      // BC ₹799 flow; only a CSP the BC creates here is linked immediately.
      if (
        role === UserRole.BC_ADMIN &&
        existingCsp &&
        existingCsp.bcId !== bcId
      ) {
        return this.requestCspLink(tx, bcId, createdBy, existingCsp, input);
      }

      //   await subscriptionService.validateMachineLimit({
      //     ownerType: SubscriptionOwnerType.BC,
      //     ownerId: bcId,
      //     requestedMachines: totalRequestedMachines,
      //   });

      const csp = await this.createOrLinkCSP(tx, bcId, createdBy, input);

      //   await activationRepository.assignMachineSlots({
      //     ownerType: SubscriptionOwnerType.BC,
      //     ownerId: bcId,
      //     agentId: csp.agentId,
      //     count: input.machineCount,
      //   });

      const createdKOs: Agent[] = [];

      if (input.kos?.length) {
        for (const koInput of input.kos) {
          const ko = await this.createOrLinkKO(
            tx,
            bcId,
            csp.agentId,
            createdBy,
            koInput,
          );

          //   await activationRepository.assignMachineSlots({
          //     ownerType: SubscriptionOwnerType.BC,
          //     ownerId: bcId,
          //     agentId: ko.agentId,
          //     count: koInput.machineCount,
          //   });

          createdKOs.push(ko);
        }
      }

      return {
        csp: mapAgent(csp),
        kos: createdKOs.map(mapAgent),
      };
    }, TRANSACTION_OPTIONS);
  }

  /*  TODO we will se if we can add the subscription restriction here in fileURLToPathBuffer 
   // check for subscription and access validation
  
        const resolver = new SubscriptionResolver(tx);
  
        const subscription = await resolver.resolveForAgent(
          filter.currentAgentId,
        );
  
        SubscriptionAccessValidator.validate(subscription);
  */
  async createKO(
    cspAgentId: string,
    createdBy: string,
    input: CreateKOInput,
  ): Promise<CreateKOResponse> {
    return this.prisma.$transaction(async (tx) => {
      const agentRepository = new AgentRepository(tx);
      const activationRepository = new ActivationRepository(tx);
      const subscriptionService = new SubscriptionService(tx);

      const csp = await agentRepository.findCSPByAgentId(cspAgentId);

      if (!csp) {
        throw new NotFoundError("CSP not found.");
      }

      //   await subscriptionService.validateMachineLimit({
      //     ownerType: SubscriptionOwnerType.CSP,
      //     ownerId: csp.agentId,
      //     requestedMachines: input.machineCount,
      //   });

      const ko = await this.createOrLinkKO(
        tx,
        csp.bcId,
        csp.agentId,
        createdBy,
        input,
      );

      //   await activationRepository.assignMachineSlots({
      //     ownerType: SubscriptionOwnerType.CSP,
      //     ownerId: csp.agentId,
      //     agentId: ko.agentId,
      //     count: input.machineCount,
      //   });

      return {
        ko: mapAgent(ko),
        // Cash moved for this KO (plan with cash management), else null.
        cash: (ko as { cash?: unknown }).cash ?? null,
      };
    }, TRANSACTION_OPTIONS);
  }

  private async requestCspLink(
    tx: Prisma.TransactionClient,
    bcId: string,
    createdBy: string,
    existingCsp: Agent,
    input: CreateCSPInput,
  ): Promise<CreateCSPResponse> {
    if (existingCsp.type !== AgentType.CSP) {
      throw new BadRequestError("Provided Agent ID does not belong to a CSP.");
    }

    if (input.kos?.length) {
      throw new BadRequestError("Add KOs after the CSP link is approved.");
    }

    const request = await raiseLinkRequest(tx, {
      bcId,
      cspAgentId: existingCsp.agentId,
      createdByUserId: createdBy,
      // A BC on a CSP-linking plan gets the ₹799 rules; otherwise it's a
      // legacy link where the BC provides the CSP's machines.
      cspSubscriptionRequired: await hasLinkingPlan(tx, bcId),
    });

    return {
      csp: null,
      kos: [],
      linkRequest: mapRequest(request, {
        userId: createdBy,
        agentId: bcId,
        role: UserRole.BC_ADMIN,
      }),
    };
  }

  private async createOrLinkCSP(
    tx: Prisma.TransactionClient,
    bcId: string,
    createdBy: string,
    input: CreateCSPInput,
  ) {
    // check for subscription and access validation
    // const resolver = new SubscriptionResolver(tx);

    // const subscription = await resolver.resolveForAgent(bcId);

    // SubscriptionAccessValidator.validate(subscription);

    // then start transaction and create or link CSP

    const agentRepository = new AgentRepository(tx);

    const existingAgent = await agentRepository.findAgentByAgentId({
      agentId: input.agentId,
    });

    if (existingAgent?.bcId === bcId) {
      throw new BadRequestError(
        "CSP is already linked with this Business Correspondent.",
      );
    }

    if (existingAgent?.bcId && existingAgent.bcId !== bcId) {
      throw new BadRequestError(
        "CSP is already linked with another Business Correspondent.",
      );
    }

    let csp;

    if (existingAgent) {
      if (existingAgent.type !== AgentType.CSP) {
        throw new BadRequestError(
          "Provided Agent ID does not belong to a CSP.",
        );
      }

      csp = await agentRepository.linkAgentToBC({
        agentId: input.agentId,
        bcId,
        linkedAt: new Date(),
        cashLimit: input.cashLimit,
        openingCash: input.openingCash,
        openingCashInAccount: input.openingCashInAccount,
        updatedBy: createdBy,
      });
    } else {
      requireNewCspCash(input);

      csp = await agentRepository.createAgent({
        agentId: input.agentId,
        name: input.name,
        type: AgentType.CSP,

        mobile: input.mobile,
        email: input.email,
        address: input.address,

        bcId,

        // The CSP limit is cash in hand + cash in account.
        cashLimit: Number(input.openingCash) + Number(input.openingCashInAccount),
        openingCash: input.openingCash,
        openingCashInAccount: input.openingCashInAccount,

        linkedAt: new Date(),

        createdBy,
      });

      // Shared cash in account for the CSP and its KOs; the CSP holds all
      // the cash in hand until it gives some to its KOs.
      await new CashService(tx).openPool({
        cspAgentId: csp.agentId,
        cashInAccount: Number(input.openingCashInAccount),
        cashInHand: Number(input.openingCash),
        actor: { type: "USER", id: createdBy },
      });
    }

    return csp;
  }

  private async createOrLinkKO(
    tx: Prisma.TransactionClient,
    // The CSP's BC; null for an independent (self-subscribed) CSP.
    bcId: string | null,
    parentAgentId: string,
    createdBy: string,
    input: CreateKOInput,
  ) {
    // check for subscription and access validation
    // const resolver = new SubscriptionResolver(tx);

    // const subscription = await resolver.resolveForAgent(bcId);

    // SubscriptionAccessValidator.validate(subscription);

    //the start transaction and create or link KO

    const agentRepository = new AgentRepository(tx);

    const existingAgent = await agentRepository.findAgentByAgentId({
      agentId: input.agentId,
    });

    if (existingAgent?.parentAgentId === parentAgentId) {
      throw new BadRequestError("KO is already linked with this CSP.");
    }

    if (
      existingAgent?.parentAgentId &&
      existingAgent.parentAgentId !== parentAgentId
    ) {
      throw new BadRequestError("KO is already linked with another CSP.");
    }

    let ko;

    if (existingAgent) {
      if (existingAgent.type !== AgentType.KO) {
        throw new BadRequestError("Provided Agent ID does not belong to a KO.");
      }

      ko = await agentRepository.linkKOToCSP({
        agentId: input.agentId,
        bcId,
        parentAgentId,
        linkedAt: new Date(),

        openingCash: input.openingCash,

        updatedBy: createdBy,
      });
    } else {
      ko = await agentRepository.createAgent({
        agentId: input.agentId,
        name: input.name,

        type: AgentType.KO,

        mobile: input.mobile,
        email: input.email,
        address: input.address,

        bcId: bcId ?? undefined,
        parentAgentId,

        // A KO uses its CSP's limit and cash in account.
        openingCash: input.openingCash,

        linkedAt: new Date(),

        createdBy,
      });
    }

    if (input.sbiUserId) {
      await requireSbiUserIdFree(tx, input.sbiUserId, ko.agentId);
      ko = await tx.agent.update({ where: { agentId: ko.agentId }, data: { sbiUserId: input.sbiUserId } });
    }

    // Cash only on a plan with cash management. The KO's cash in hand comes
    // out of the CSP's own (or the agents the CSP adjusted in the form);
    // what isn't covered raises the cash limit. Agents whose cash in hand
    // changed get an "Adjust" request on the desktop.
    const cashManagement = await planHasCashManagement(tx, parentAgentId);

    if (cashManagement && input.openingCash === undefined) {
      throw new BadRequestError("Cash in hand is required.");
    }

    if (cashManagement && input.openingCash !== undefined) {
      const cash = await new CashService(tx).addAgent({
        cspAgentId: parentAgentId,
        agentId: ko.agentId,
        cashInHand: input.openingCash,
        adjustments: input.cashAdjustments,
        drawerRequests: true,
        actor: { type: "USER", id: createdBy },
      });

      return Object.assign(ko, { cash });
    }

    return ko;
  }

  async getAgent(
    agentId: string,
    currentUser: CurrentUser,
  ): Promise<AgentResponse> {
    const repository = new AgentRepository(this.prisma);

    const scope = await new AgentScopeService(this.prisma).getAgentScope(
      currentUser,
      true,
    );

    // Users can read themselves and agents in their scope.
    const inScope =
      agentId === currentUser.agentId ||
      scope.length === 0 ||
      scope.includes(agentId);

    const agent = inScope ? await repository.findByAgentId(agentId) : null;

    if (!agent) {
      throw new NotFoundError("Agent not found.");
    }

    const [withPlan] = await this.withOwnSubscription([mapAgent(agent)], currentUser);

    return withPlan;
  }

  /*  TODO we will se if we can add the subscription restriction here in fileURLToPathBuffer 
   // check for subscription and access validation
  
        const resolver = new SubscriptionResolver(tx);
  
        const subscription = await resolver.resolveForAgent(
          filter.currentAgentId,
        );
  
        SubscriptionAccessValidator.validate(subscription);
  */
  async listAgents(filters: ListAgentsDto, currentUser: CurrentUser) {
    console.log("filters =>", filters);
    const repository = new AgentRepository(this.prisma);

    // Only agents in the caller's scope (empty scope = SUPER_ADMIN, all).
    // Inactive agents too: the owner reactivates them from this list.
    const agentIds = await new AgentScopeService(this.prisma).getAgentScope(
      currentUser,
      true,
    );

    const skip = (filters.page - 1) * filters.limit;

    const [agents, total] = await Promise.all([
      repository.findMany({
        type: filters.type,
        bcId: filters.bcId,
        parentAgentId: filters.parentAgentId,
        agentIds,
        skip,
        take: filters.limit,
      }),

      repository.count({
        type: filters.type,
        bcId: filters.bcId,
        parentAgentId: filters.parentAgentId,
        agentIds,
      }),
    ]);

    return {
      items: await this.withOwnSubscription(agents.map(mapAgent), currentUser),

      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  /**
   * For a BC (and the super admin): each CSP's own CSP subscription, so the
   * app can show "Own plan active" / "No own plan yet". The CSP's latest
   * subscription (any status), or null when it never bought one; KOs: null.
   */
  private async withOwnSubscription<T extends { agentId: string; type: string }>(
    items: T[],
    currentUser: CurrentUser,
  ) {
    if (currentUser.role !== UserRole.BC_ADMIN && currentUser.role !== UserRole.SUPER_ADMIN) {
      return items;
    }

    const cspIds = items.filter((item) => item.type === "CSP").map((item) => item.agentId);
    const subscriptions = cspIds.length
      ? await this.prisma.subscription.findMany({
          where: { ownerId: { in: cspIds }, ownerType: SubscriptionOwnerType.CSP },
          orderBy: { createdAt: "desc" },
          select: { ownerId: true, status: true, endDate: true, graceEndsAt: true, plan: { select: { code: true } } },
        })
      : [];

    const latest = new Map<string, (typeof subscriptions)[number]>();

    for (const subscription of subscriptions) {
      if (!latest.has(subscription.ownerId)) {
        latest.set(subscription.ownerId, subscription);
      }
    }

    return items.map((item) => {
      const own = item.type === "CSP" ? latest.get(item.agentId) : undefined;

      return {
        ...item,
        ownSubscription: own
          ? {
              // Still ACTIVE during the grace period.
              status: (own.graceEndsAt ?? own.endDate) < new Date() && own.status === "ACTIVE" ? "EXPIRED" : own.status,
              endDate: own.endDate,
              graceEndsAt: own.graceEndsAt,
              planCode: own.plan.code,
            }
          : null,
      };
    });
  }

  async updateAgent(
    agentId: string,
    data: UpdateAgentDto,
    currentUser: CurrentUser,
  ) {
    // A CSP manages its KOs even without a running plan (renew / subscribe
    // and KO management stay open); others need one.
    if (currentUser.role !== UserRole.CSP_ADMIN) {
      const subscription = await new SubscriptionResolver(
        this.prisma,
      ).getEffectiveSubscription(currentUser.agentId);

      SubscriptionAccessValidator.validate(subscription);
    }

    const repository = new AgentRepository(this.prisma);
    const agent = await repository.findByAgentId(agentId);

    if (!agent || agent.isDeleted) {
      throw new NotFoundError("Agent not found.");
    }

    //access to only current authorization
    if (!canManageAgent(currentUser, agent)) {
      throw new ForbiddenError("You are not allowed to update this agent.");
    }

    await this.ensureNotViewOnlyLink(repository, currentUser, agent);

    if (data.sbiUserId) {
      await requireSbiUserIdFree(this.prisma, data.sbiUserId, agentId);
    }

    const emailChanged =
      data.email !== undefined &&
      (data.email ?? "").toLowerCase() !== (agent.email ?? "").toLowerCase();

    const updatedAgent = await repository.updateAgent(agentId, {
      ...data,
      // A new email must be verified again (desktop cash panel / activation).
      ...(emailChanged && { emailVerifiedAt: null }),
      updatedBy: currentUser.agentId,
    });

    return mapAgent(updatedAgent);
  }

  /**
   * A CSP linked through a BC ₹799 link request runs on its own subscription:
   * the BC can view it and its KOs but not edit or delete them.
   */
  private async ensureNotViewOnlyLink(
    repository: AgentRepository,
    currentUser: CurrentUser,
    agent: Agent,
  ) {
    if (
      currentUser.role !== UserRole.BC_ADMIN ||
      agent.agentId === currentUser.agentId
    ) {
      return;
    }

    const csp =
      agent.type === AgentType.KO && agent.parentAgentId
        ? await repository.findByAgentId(agent.parentAgentId)
        : agent;

    if (csp?.bcLinkedByRequest) {
      throw new ForbiddenError(
        "This CSP is linked for viewing only. It manages its own account.",
      );
    }
  }

  async deleteAgent(agentId: string, currentUser: CurrentUser) {
    if (currentUser.role !== UserRole.CSP_ADMIN) {
      const subscription = await new SubscriptionResolver(
        this.prisma,
      ).getEffectiveSubscription(currentUser.agentId);

      SubscriptionAccessValidator.validate(subscription);
    }

    const repository = new AgentRepository(this.prisma);
    const agent = await repository.findByAgentId(agentId);

    if (!agent || agent.isDeleted) {
      throw new NotFoundError("Agent not found.");
    }

    if (agent.agentId === currentUser.agentId) {
      throw new BadRequestError("You cannot delete your own account.");
    }

    if (!canManageAgent(currentUser, agent)) {
      throw new ForbiddenError("You are not allowed to delete this agent.");
    }

    await this.ensureNotViewOnlyLink(repository, currentUser, agent);

    const childCount = await repository.countChildren(agent.agentId);

    if (childCount > 0) {
      throw new BadRequestError("Delete child agents first.");
    }

    await this.prisma.$transaction(async (tx) => {
      // A deleted KO's cash management goes with it: its cash in hand and
      // drawer leave the pool (the limit goes down by it).
      if (agent.type === AgentType.KO && agent.parentAgentId) {
        await new CashService(tx).removeAgent({
          cspAgentId: agent.parentAgentId,
          agentId: agent.agentId,
          actor: { type: "USER", id: currentUser.userId },
        });
      }

      await new AgentRepository(tx).softDeleteAgent(agentId, currentUser.agentId);
    }, TRANSACTION_OPTIONS);
  }

  /**
   * Replace a KO (CSP): a new KO takes the old one's place. Its activation
   * (machine) and its cash management (cash in hand, drawer, open dues,
   * tasks, open settlements, adjust requests) move to the new KO, and the
   * old KO is deleted. The new KO re-verifies its email on the desktop.
   */
  async replaceKO(
    oldAgentId: string,
    input: { agentId: string; name: string; mobile?: string; email?: string; address?: string },
    currentUser: CurrentUser,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const repository = new AgentRepository(tx);
      const old = await repository.findByAgentId(oldAgentId);

      if (
        !old ||
        old.isDeleted ||
        old.type !== AgentType.KO ||
        old.parentAgentId !== currentUser.agentId
      ) {
        throw new NotFoundError("KO not found.");
      }

      if (input.agentId === oldAgentId) {
        throw new BadRequestError("The new KO needs a different Agent ID.");
      }

      const existing = await repository.findAgentByAgentId({ agentId: input.agentId });

      if (existing && !existing.isDeleted) {
        throw new BadRequestError("An agent with this Agent ID already exists.");
      }

      const ko = await repository.createAgent({
        agentId: input.agentId,
        name: input.name,
        type: AgentType.KO,
        mobile: input.mobile,
        email: input.email,
        address: input.address,
        bcId: old.bcId ?? undefined,
        parentAgentId: currentUser.agentId,
        linkedAt: new Date(),
        createdBy: currentUser.userId,
      });

      const cash = await new CashService(tx).transferAgent({
        cspAgentId: currentUser.agentId,
        fromAgentId: oldAgentId,
        toAgentId: ko.agentId,
        actor: { type: "USER", id: currentUser.userId },
      });

      // The machine keeps working for the new KO (no re-activation).
      const activations = await tx.activation.findMany({
        where: {
          assignedAgentId: oldAgentId,
          isCurrent: true,
          status: { in: ["ACTIVE", "NOT_ACTIVATED"] },
        },
        select: { id: true, machineId: true },
      });

      await tx.activation.updateMany({
        where: { id: { in: activations.map((activation) => activation.id) } },
        data: { assignedAgentId: ko.agentId, assignedAt: new Date() },
      });

      const machineIds = activations.flatMap((activation) =>
        activation.machineId ? [activation.machineId] : [],
      );

      await tx.machine.updateMany({
        where: { id: { in: machineIds } },
        data: {
          currentAgentId: ko.agentId,
          agentId: ko.agentId,
          cashAgentId: null,
          cashAgentLoginMethod: null,
          cashAgentLoginAt: null,
          updatedBy: currentUser.userId,
        },
      });

      await tx.machine.updateMany({
        where: { cashAgentId: oldAgentId },
        data: { cashAgentId: null, cashAgentLoginMethod: null, cashAgentLoginAt: null },
      });

      await repository.softDeleteAgent(oldAgentId, currentUser.agentId);

      return {
        ko: mapAgent(ko),
        replaced: oldAgentId,
        cash,
        machines: machineIds.length,
      };
    }, TRANSACTION_OPTIONS);
  }
}

/** One agent per SBI kiosk User ID (it decides whose cash a shared PC uses). */
async function requireSbiUserIdFree(db: PrismaDb, sbiUserId: string, exceptAgentId: string) {
  const taken = await db.agent.findFirst({
    where: {
      agentId: { not: exceptAgentId },
      isDeleted: false,
      OR: [{ sbiUserId }, { agentId: { equals: sbiUserId, mode: "insensitive" } }],
    },
    select: { agentId: true },
  });

  if (taken) {
    throw new ConflictError("This SBI user ID belongs to another agent.", "SBI_USER_ID_TAKEN");
  }
}
