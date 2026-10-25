import { BadRequestError } from "../../../core/errors/BadRequestError";
import { ForbiddenError } from "../../../core/errors/ForbiddenError";
import { NotFoundError } from "../../../core/errors/NotFoundError";
import { CurrentUser } from "../../../core/types/auth.types";
import {
  Agent,
  AgentType,
  FloatLedgerType,
  Prisma,
  PrismaClient,
  SubscriptionOwnerType,
} from "../../../generated/prisma/client";
import ActivationRepository from "../../activations/activation.repository";
import FloatLedgerService from "../../float/float-ledger.service";
import { mapOpeningBalance } from "../../float/opening-balance.mapper";
import SubscriptionAccessValidator from "../../subscriptions/subscription-validator/subscription-access-validator";
import SubscriptionResolver from "../../subscriptions/subscription-validator/subscription-resolver.service";
import SubscriptionService from "../../subscriptions/subscription.service";
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
    });
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
      };
    });
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
        updatedBy: createdBy,
      });
    } else {
      csp = await agentRepository.createAgent({
        agentId: input.agentId,
        name: input.name,
        type: AgentType.CSP,

        mobile: input.mobile,
        email: input.email,
        address: input.address,

        bcId,

        cashLimit: input.cashLimit,
        openingCash: input.openingCash,

        linkedAt: new Date(),

        createdBy,
      });

      const floatLedgerService = new FloatLedgerService(tx);

      await floatLedgerService.record({
        agentId: csp.agentId,

        ledgerType: FloatLedgerType.OPENING,

        openingBalance: mapOpeningBalance(csp),

        remarks: "Opening balance",
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

        cashLimit: input.cashLimit,
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

        cashLimit: input.cashLimit,
        openingCash: input.openingCash,

        linkedAt: new Date(),

        createdBy,
      });
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

    return mapAgent(agent);
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
    const agentIds = await new AgentScopeService(this.prisma).getAgentScope(
      currentUser,
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
      items: agents.map(mapAgent),

      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  async updateAgent(
    agentId: string,
    data: UpdateAgentDto,
    currentUser: CurrentUser,
  ) {
    const resolver = new SubscriptionResolver(this.prisma);

    const subscription = await resolver.getEffectiveSubscription(
      currentUser.agentId,
    );

    SubscriptionAccessValidator.validate(subscription);

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

    const updatedAgent = await repository.updateAgent(agentId, {
      ...data,
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
    const resolver = new SubscriptionResolver(this.prisma);

    const subscription = await resolver.getEffectiveSubscription(
      currentUser.agentId,
    );

    SubscriptionAccessValidator.validate(subscription);

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

    await repository.softDeleteAgent(agentId, currentUser.agentId);
  }
}
