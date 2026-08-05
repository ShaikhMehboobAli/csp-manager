import { PrismaDb } from "../../core/database/prisma.types";
import { Prisma } from "../../generated/prisma/client";

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

  async findByReceiptId(receiptId: string) {
    return this.db.receipt.findUnique({
      where: {
        receiptId,
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

  async findExistingReceiptIds(receiptIds: string[]) {
    const receipts = await this.db.receipt.findMany({
      where: {
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
}
