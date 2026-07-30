import { PrismaDb } from "../database/prisma.types";
import { RunningNumberType } from "../../generated/prisma/enums";

export default class RunningNumberRepository {
  constructor(private readonly db: PrismaDb) {}

  async getNextValue(type: RunningNumberType) {
    // const runningNumber = await this.db.runningNumber.update({
    //   where: {
    //     type,
    //   },
    //   data: {
    //     currentValue: {
    //       increment: 1,
    //     },
    //   },
    // });

    const runningNumber = await this.db.runningNumber.upsert({
      where: {
        type,
      },
      create: {
        type,
        currentValue: 1,
      },
      update: {
        currentValue: {
          increment: 1,
        },
      },
    });

    return Number(runningNumber.currentValue);
  }
}
