import { PrismaDb } from "../../../core/database/prisma.types";

export default class MachineHeartbeatRepository {
  constructor(private readonly db: PrismaDb) {}

  async updateHeartbeat(
    machineId: string,
    data: {
      watcherVersion: string;
      osName?: string;
      osVersion?: string;
      deviceName?: string;
      ipAddress?: string;
      lastStartupAt?: Date;
      lastTransactionAt?: Date;
    },
  ) {
    return this.db.machine.update({
      where: {
        id: machineId,
      },
      data: {
        watcherVersion: data.watcherVersion,
        osName: data.osName,
        osVersion: data.osVersion,
        deviceName: data.deviceName,
        ipAddress: data.ipAddress,
        lastStartupAt: data.lastStartupAt,
        lastTransactionAt: data.lastTransactionAt,
        lastHeartbeatAt: new Date(),
        isOnline: true,
      },
    });
  }
}
