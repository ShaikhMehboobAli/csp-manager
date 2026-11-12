import { PrismaDb } from "../../../core/database/prisma.types";
import { Prisma } from "../../../generated/prisma/client";

export default class ReceiptRepository {
  constructor(private readonly db: PrismaDb) {}

  async create(
    data: Prisma.ReceiptCreateInput,
    tx: Prisma.TransactionClient = this.db,
  ) {
    return tx.receipt.create({
      data,
    });
  }

  async createMany(
    data: Prisma.ReceiptCreateManyInput[],
    tx: Prisma.TransactionClient = this.db,
  ) {
    return tx.receipt.createMany({
      data,
    });
  }

  // receiptId is unique per agent.
  async findByReceiptId(agentId: string, receiptId: string) {
    return this.db.receipt.findUnique({
      where: {
        agentId_receiptId: {
          agentId,
          receiptId,
        },
      },
    });
  }

  async findByStanAndRrn(stan?: string, rrn?: string) {
    if (!stan && !rrn) {
      return null;
    }

    return this.db.receipt.findFirst({
      where: {
        ...(stan && { stan }),
        ...(rrn && { rrn }),
      },
    });
  }

  async findExistingReceiptIds(agentId: string, receiptIds: string[]) {
    const receipts = await this.db.receipt.findMany({
      where: {
        agentId,
        receiptId: {
          in: receiptIds,
        },
      },
      select: {
        receiptId: true,
      },
    });

    return new Set(receipts.map((receipt) => receipt.receiptId));
  }

  async createIfAbsent(data: Prisma.ReceiptCreateManyInput) {
    const result = await this.db.receipt.createMany({
      data: [data],
      skipDuplicates: true,
    });

    return result.count === 1;
  }

  // Inserts the receipts that don't exist yet and returns only those.
  async createManyIfAbsent(data: Prisma.ReceiptCreateManyInput[]) {
    if (data.length === 0) {
      return [];
    }

    return this.db.receipt.createManyAndReturn({
      data,
      skipDuplicates: true,
      select: {
        id: true,
        receiptId: true,
        // Fields the daily counts need.
        agentId: true,
        machineId: true,
        receiptType: true,
        transactionCategory: true,
        transactionType: true,
        status: true,
        transactionAt: true,
        amount: true,
        commissionAmount: true,
      },
    });
  }

  // Same, returning the full rows (legacy watcher response).
  async createManyAndReturnIfAbsent(data: Prisma.ReceiptCreateManyInput[]) {
    if (data.length === 0) {
      return [];
    }

    return this.db.receipt.createManyAndReturn({
      data,
      skipDuplicates: true,
    });
  }

  async createCashDenominations(
    data: Prisma.ReceiptCashDenominationCreateManyInput[],
  ) {
    if (data.length === 0) {
      return;
    }

    await this.db.receiptCashDenomination.createMany({ data });
  }

  async createCashDenomination(
    receiptRecordId: string,
    denomination: {
      notes500: number;
      notes200: number;
      notes100: number;
      notes50: number;
      notes20: number;
      notes10: number;
      notes5: number;
      coins20: number;
      coins10: number;
      coins5: number;
      coins2: number;
      coins1: number;
    },
  ) {
    return this.db.receiptCashDenomination.create({
      data: {
        receiptRecordId,
        ...denomination,
      },
    });
  }

  // Machines can be assigned to a CSP or to one of its KOs.
  async findAssignedAgent(agentId: string) {
    return this.db.agent.findFirst({
      where: {
        agentId,
        isDeleted: false,
        type: {
          in: ["CSP", "KO"],
        },
      },
      select: {
        agentId: true,
      },
    });
  }

  // From the daily counts, which outlive the receipts (kept for a year).
  async getCumulativeCounts(agentId: string) {
    const [byReceiptType, byTransactionCategory, byTransactionType] =
      await Promise.all([
        this.db.receiptDailyCount.groupBy({
          by: ["receiptType"],
          where: { agentId },
          _sum: { count: true },
        }),
        this.db.receiptDailyCount.groupBy({
          by: ["transactionCategory"],
          where: { agentId },
          _sum: { count: true },
        }),
        this.db.receiptDailyCount.groupBy({
          by: ["transactionType"],
          where: { agentId },
          _sum: { count: true },
        }),
      ]);

    return {
      receiptType: Object.fromEntries(
        byReceiptType.map(({ receiptType, _sum }) => [
          receiptType,
          Number(_sum.count ?? 0),
        ]),
      ),
      transactionCategory: Object.fromEntries(
        byTransactionCategory.map(({ transactionCategory, _sum }) => [
          transactionCategory,
          Number(_sum.count ?? 0),
        ]),
      ),
      transactionType: Object.fromEntries(
        byTransactionType.map(({ transactionType, _sum }) => [
          transactionType,
          Number(_sum.count ?? 0),
        ]),
      ),
    };
  }
}
