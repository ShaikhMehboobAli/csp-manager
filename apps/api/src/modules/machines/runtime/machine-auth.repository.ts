import { PrismaDb } from "../../../core/database/prisma.types";

export default class MachineAuthenticationRepository {
  constructor(private readonly db: PrismaDb) {}

  async findMachineForAuthentication(machineCode: string) {
    return this.db.machine.findUnique({
      where: {
        machineCode,
      },
      include: {
        activations: {
          where: {
            isCurrent: true,
          },
          include: {
            subscription: true,
          },
          take: 1,
        },
      },
    });
  }
}
