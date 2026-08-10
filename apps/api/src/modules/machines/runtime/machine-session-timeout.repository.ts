// import { PrismaDb } from "../../../core/database/prisma.types";
// import {
//   MachineSessionStatus,
//   SessionEndReason,
// } from "../../../generated/prisma/enums";

// export default class MachineSessionTimeoutRepository {
//   constructor(private readonly db: PrismaDb) {}

//   async findTimedOutSessions(timeoutDate: Date) {
//     return this.db.machineSession.findMany({
//       where: {
//         status: MachineSessionStatus.ACTIVE,

//         lastHeartbeatAt: {
//           lt: timeoutDate,
//         },
//       },
//     });
//   }

//   async closeTimedOutSession(sessionId: string, endedAt: Date) {
//     return this.db.machineSession.update({
//       where: {
//         id: sessionId,
//       },

//       data: {
//         status: MachineSessionStatus.CLOSED,

//         endedAt,

//         endedReason: SessionEndReason.HEARTBEAT_TIMEOUT,

//         isUnexpectedStop: true,
//       },
//     });
//   }
// }
