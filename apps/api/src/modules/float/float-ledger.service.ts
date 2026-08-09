import { BadRequestError } from "../../core/errors/BadRequestError";
import { PrismaDb } from "../../core/database/prisma.types";

import { FloatLedgerType } from "../../generated/prisma/enums";

import FloatLedgerRepository from "./float-ledger.repository";
import AgentFloatRepository from "./agent-float.repository";

import { RecordLedgerInput } from "./float-ledger.types";
import { getLedgerRule } from "./config/ledger-rule.helper";
import {
  calculateNextBalance,
  LedgerCalculationResult,
} from "./float-ledger.mapper";
import { CashEffect } from "./config/ledger-rule.config";
import { applyManualBalance } from "./float-financial.mapper";
import { AgentRepository } from "../agents/repository/agent.repository";
import { Logger } from "../../core/utils/logger";

export default class FloatLedgerService {
  private readonly ledgerRepository: FloatLedgerRepository;

  private readonly agentFloatRepository: AgentFloatRepository;

  private readonly agentRepository: AgentRepository;

  constructor(private readonly db: PrismaDb) {
    this.ledgerRepository = new FloatLedgerRepository(db);

    this.agentFloatRepository = new AgentFloatRepository(db);

    this.agentRepository = new AgentRepository(db);
  }

  async record(input: RecordLedgerInput) {
    switch (input.ledgerType) {
      case FloatLedgerType.OPENING:
        return this.recordOpening(input);

      case FloatLedgerType.RECEIPT:
        return this.recordReceipt(input);

      case FloatLedgerType.OPENING_ADJUSTMENT:
      case FloatLedgerType.ADJUSTMENT:
      case FloatLedgerType.LIMIT_TOPUP:
      case FloatLedgerType.LIMIT_REDUCTION:
      case FloatLedgerType.CORRECTION:
      case FloatLedgerType.RENEWAL_ADJUSTMENT:
        return this.recordFinancialEvent(input);

      default:
        throw new BadRequestError("Unsupported ledger type.");
    }
  }

  private async createLedger(input: {
    agentId: string;

    ledgerType: FloatLedgerType;

    cashInHandChange: number;

    cashInAccountChange: number;

    balanceCashInHand: number;

    balanceCashInAccount: number;

    receiptId?: string;

    remarks?: string;

    approvedBy?: string;
  }) {
    return this.ledgerRepository.create({
      ledgerType: input.ledgerType,

      cashInHandChange: input.cashInHandChange,

      cashInAccountChange: input.cashInAccountChange,

      balanceCashInHand: input.balanceCashInHand,

      balanceCashInAccount: input.balanceCashInAccount,

      remarks: input.remarks,

      approvedBy: input.approvedBy,

      agent: {
        connect: {
          agentId: input.agentId,
        },
      },

      ...(input.receiptId && {
        receipt: {
          connect: {
            receiptId: input.receiptId,
          },
        },
      }),
    });
  }

  private async recordOpening(input: RecordLedgerInput) {
    if (!input.openingBalance) {
      throw new BadRequestError("Opening balance is required.");
    }

    const existing = await this.agentFloatRepository.findByAgentId(
      input.agentId,
    );

    if (existing) {
      throw new BadRequestError("Opening float is already initialized.");
    }

    const cashInHand = input.openingBalance.cashInHand;

    const cashInAccount = input.openingBalance.cashInAccount;

    await this.agentFloatRepository.initialize(
      input.agentId,
      cashInHand,
      cashInAccount,
    );

    return this.createLedger({
      agentId: input.agentId,

      ledgerType: FloatLedgerType.OPENING,

      cashInHandChange: cashInHand,

      cashInAccountChange: cashInAccount,

      balanceCashInHand: cashInHand,

      balanceCashInAccount: cashInAccount,

      remarks: input.remarks ?? "Opening Float",
    });
  }

  //   private async getOrCreateAgentFloat(agentId: string) {
  //     let agentFloat = await this.agentFloatRepository.findByAgentId(agentId);

  //     if (agentFloat) {
  //       return agentFloat;
  //     }

  //     // TODO:
  //     // Replace this once Agent stores
  //     // openingCashInHand/openingCashInAccount

  //     // TODO:
  //     // Read openingCash and cashLimit from Agent
  //     // once AgentRepository is injected.

  //     const openingCashInHand = 0;
  //     const openingCashInAccount = 0;

  //     agentFloat = await this.agentFloatRepository.initialize(
  //       agentId,
  //       openingCashInHand,
  //       openingCashInAccount,
  //     );

  //     await this.createLedger({
  //       agentId,

  //       ledgerType: FloatLedgerType.OPENING,

  //       cashInHandChange: openingCashInHand,

  //       cashInAccountChange: openingCashInAccount,

  //       balanceCashInHand: openingCashInHand,

  //       balanceCashInAccount: openingCashInAccount,

  //       remarks: "Auto initialized opening float",
  //     });

  //     return agentFloat;
  //   }

  private async getOrCreateAgentFloat(agentId: string) {
    let agentFloat = await this.agentFloatRepository.findByAgentId(agentId);

    if (agentFloat) {
      return agentFloat;
    }

    const agent = await this.agentRepository.findByAgentId(agentId);

    if (!agent) {
      throw new BadRequestError("Agent not found.");
    }

    const cashInHand = Number(agent.openingCash ?? 0);

    const cashInAccount = Number(agent.cashLimit ?? 0);

    agentFloat = await this.agentFloatRepository.initialize(
      agentId,
      cashInHand,
      cashInAccount,
    );

    await this.createLedger({
      agentId,

      ledgerType: FloatLedgerType.OPENING,

      cashInHandChange: cashInHand,

      cashInAccountChange: cashInAccount,

      balanceCashInHand: cashInHand,

      balanceCashInAccount: cashInAccount,

      remarks: "Auto initialized opening float",
    });

    Logger.warn(`AgentFloat auto-created for legacy agent ${agentId}.`);

    return agentFloat;
  }

  /*  TODO we will se if we can add the subscription restriction here in fileURLToPathBuffer 
   // check for subscription and access validation
  
        const resolver = new SubscriptionResolver(tx);
  
        const subscription = await resolver.resolveForAgent(
          filter.currentAgentId,
        );
  
        SubscriptionAccessValidator.validate(subscription);
  */
  private async updateAgentFloat(
    agentId: string,
    balance: LedgerCalculationResult,
  ) {
    await this.agentFloatRepository.update(agentId, {
      currentCashInHand: balance.balanceCashInHand,

      currentCashInAccount: balance.balanceCashInAccount,

      currentTotalFloat: balance.balanceTotalFloat,

      lastReceiptAt: new Date(),
    });
  }

  /*  TODO we will se if we can add the subscription restriction here in file
   // check for subscription and access validation
  
        const resolver = new SubscriptionResolver(tx);
  
        const subscription = await resolver.resolveForAgent(
          filter.currentAgentId,
        );
  
        SubscriptionAccessValidator.validate(subscription);
  */
  private async recordReceipt(input: RecordLedgerInput) {
    if (!input.transactionCategory) {
      throw new BadRequestError("Transaction category is required.");
    }

    if (!input.receiptId) {
      throw new BadRequestError("Receipt id is required.");
    }

    if (input.amount === undefined) {
      throw new BadRequestError("Amount is required.");
    }

    // Get ledger rule
    const rule = getLedgerRule(input.transactionCategory);

    if (!rule) {
      throw new BadRequestError("Ledger rule not found.");
    }

    // Transaction doesn't affect ledger
    if (!rule.createLedger) {
      return null;
    }

    // Prevent duplicate ledger creation
    const existingLedger = await this.ledgerRepository.findByReceiptId(
      input.receiptId,
    );

    if (existingLedger) {
      return existingLedger;
    }

    return this.applyLedger(input, rule.cashEffect);
  }

  private async applyLedger(input: RecordLedgerInput, cashEffect: CashEffect) {
    // const agentFloat = await this.agentFloatRepository.findByAgentId(
    //   input.agentId,
    // );

    const agentFloat = await this.getOrCreateAgentFloat(input.agentId);

    if (!agentFloat) {
      throw new BadRequestError("Agent float is not initialized.");
    }

    const balance = calculateNextBalance(
      {
        cashInHand: Number(agentFloat.currentCashInHand),

        cashInAccount: Number(agentFloat.currentCashInAccount),

        totalFloat: Number(agentFloat.currentTotalFloat),
      },

      input.amount!,

      cashEffect,
    );

    const ledger = await this.createLedger({
      agentId: input.agentId,

      ledgerType: input.ledgerType,

      cashInHandChange: balance.cashInHandChange,

      cashInAccountChange: balance.cashInAccountChange,

      balanceCashInHand: balance.balanceCashInHand,

      balanceCashInAccount: balance.balanceCashInAccount,

      receiptId: input.receiptId,

      remarks: input.remarks,

      approvedBy: input.approvedBy,
    });

    await this.updateAgentFloat(input.agentId, balance);

    return ledger;
  }

  private async recordFinancialEvent(input: RecordLedgerInput) {
    if (
      input.cashInHandChange === undefined ||
      input.cashInAccountChange === undefined
    ) {
      throw new BadRequestError("Financial balance changes are required.");
    }

    const agentFloat = await this.getOrCreateAgentFloat(input.agentId);

    const balance = applyManualBalance(
      {
        cashInHand: Number(agentFloat.currentCashInHand),

        cashInAccount: Number(agentFloat.currentCashInAccount),

        totalFloat: Number(agentFloat.currentTotalFloat),
      },
      {
        cashInHandChange: input.cashInHandChange,

        cashInAccountChange: input.cashInAccountChange,
      },
    );

    const ledger = await this.createLedger({
      agentId: input.agentId,

      ledgerType: input.ledgerType,

      cashInHandChange: balance.cashInHandChange,

      cashInAccountChange: balance.cashInAccountChange,

      balanceCashInHand: balance.balanceCashInHand,

      balanceCashInAccount: balance.balanceCashInAccount,

      remarks: input.remarks,

      approvedBy: input.approvedBy,
    });

    await this.updateAgentFloat(input.agentId, balance);

    return ledger;
  }
}
