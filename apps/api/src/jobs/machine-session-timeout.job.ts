// import MachineSessionRepository from "../modules/machines/runtime/machine-session.repository";
// import runtimeConfig from "../config/runtime.config";
// import prisma from "../config/prisma";

// export default class MachineSessionTimeoutJob {
//   private readonly repository =
//     new MachineSessionRepository(prisma);

//   async execute() {
//     const timeoutDate = new Date(
//       Date.now() - runtimeConfig.HEARTBEAT_TIMEOUT,
//     );

//     const sessions =
//       await this.repository.findTimedOutSessions(timeoutDate);

//     for (const session of sessions) {
//       await this.repository.closeSession(session.id);

//       await this.repository.markMachineOffline(
//         session.machineId,
//       );

//       console.log(
//         `Machine session ${session.machineSessionId} closed.`,
//       );
//     }
//   }
// }
// TODO:
// Implement MachineSession timeout job.
// This will periodically close ACTIVE sessions whose
// lastHeartbeatAt exceeds the configured timeout.
