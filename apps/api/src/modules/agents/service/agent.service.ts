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
import { ListAgentsDto } from "../validations/list-agents.validation";
import { UpdateAgentDto } from "../validations/update-agent.validation";

export class AgentService {
  //   private readonly subscriptionService: SubscriptionService;

  constructor(private readonly prisma: PrismaClient) {
    // this.agentRepository = new AgentRepository(prisma);
    // this.activationRepository = new ActivationRepository(prisma);
    // this.subscriptionService = new SubscriptionService(this.prisma);
  }

  async createCSP(
    bcId: string,
    createdBy: string,
    input: CreateCSPInput,
  ): Promise<CreateCSPResponse> {
    const totalRequestedMachines =
      input.machineCount +
      (input.kos?.reduce((total, ko) => total + ko.machineCount, 0) ?? 0);

    return this.prisma.$transaction(async (tx) => {
      const activationRepository = new ActivationRepository(tx);
      const subscriptionService = new SubscriptionService(tx);

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

      if (!csp.bcId) {
        throw new BadRequestError(
          "CSP is not linked with any Business Correspondent.",
        );
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

  private async createOrLinkCSP(
    tx: Prisma.TransactionClient,
    bcId: string,
    createdBy: string,
    input: CreateCSPInput,
  ) {
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
    bcId: string,
    parentAgentId: string,
    createdBy: string,
    input: CreateKOInput,
  ) {
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

        bcId,
        parentAgentId,

        cashLimit: input.cashLimit,
        openingCash: input.openingCash,

        linkedAt: new Date(),

        createdBy,
      });
    }

    return ko;
  }

  async getAgent(agentId: string): Promise<AgentResponse> {
    const repository = new AgentRepository(this.prisma);

    const agent = await repository.findByAgentId(agentId);

    if (!agent) {
      throw new NotFoundError("Agent not found.");
    }

    return mapAgent(agent);
  }

  //   async listAgents(filters: {
  //     type?: AgentType;
  //     bcId?: string;
  //     parentAgentId?: string;
  //   }): Promise<AgentResponse[]> {
  //     const repository = new AgentRepository(this.prisma);

  //     const agents = await repository.findMany(filters);

  //     return agents.map(mapAgent);
  //   }

  async listAgents(filters: ListAgentsDto) {
    console.log("filters =>", filters);
    const repository = new AgentRepository(this.prisma);

    const skip = (filters.page - 1) * filters.limit;

    const [agents, total] = await Promise.all([
      repository.findMany({
        type: filters.type,
        bcId: filters.bcId,
        parentAgentId: filters.parentAgentId,
        skip,
        take: filters.limit,
      }),

      repository.count({
        type: filters.type,
        bcId: filters.bcId,
        parentAgentId: filters.parentAgentId,
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
    const repository = new AgentRepository(this.prisma);
    const agent = await repository.findByAgentId(agentId);

    if (!agent || agent.isDeleted) {
      throw new NotFoundError("Agent not found.");
    }

    //access to only current authorization
    if (!canManageAgent(currentUser, agent)) {
      throw new ForbiddenError("You are not allowed to update this agent.");
    }

    const updatedAgent = await repository.updateAgent(agentId, {
      ...data,
      updatedBy: currentUser.agentId,
    });

    return mapAgent(updatedAgent);
  }

  async deleteAgent(agentId: string, currentUser: CurrentUser) {
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

    const childCount = await repository.countChildren(agent.agentId);

    if (childCount > 0) {
      throw new BadRequestError("Delete child agents first.");
    }

    await repository.softDeleteAgent(agentId, currentUser.agentId);
  }
}
