import { PrismaDb } from "../database/prisma.types";
import { RunningNumberType } from "../../generated/prisma/enums";

export default class RunningNumberRepository {
  constructor(private readonly db: PrismaDb) {}

  async getNextValue(type: RunningNumberType) {
    const runningNumber = await this.db.runningNumber.update({
      where: {
        type,
      },
      data: {
        currentValue: {
          increment: 1,
        },
      },
    });

    return Number(runningNumber.currentValue);
  }
}
