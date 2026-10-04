// import MachineActivationService from "./services/machine-activation.service";

// import { ActivateMachineInput } from "./types/service.types";

// export default class MachineService {
//   private readonly activationService = new MachineActivationService();

//   async activateMachine(data: ActivateMachineInput) {
//     return this.activationService.activate(data);
//   }
// }

import { CurrentUser } from "../../core/types/auth.types";
import MachineActivationService from "./services/machine-activation.service";
import MachineListService from "./services/machine-list.service";
import { MachineDetailFilter, MachineListFilter } from "./types/machine.types";
// import MachineUpdateService from "./services/machine-update.service";
// import MachineHeartbeatService from "./services/machine-heartbeat.service";

import {
  ActivateMachineInput,
  // UpdateMachineInput,
} from "./types/service.types";

export default class MachineService {
  private readonly activationService = new MachineActivationService();

  private readonly listService = new MachineListService();

  // private readonly updateService = new MachineUpdateService();

  // private readonly heartbeatService = new MachineHeartbeatService();

  async activateMachine(data: ActivateMachineInput) {
    return this.activationService.activate(data);
  }

  async getMachines(user: CurrentUser, filter: MachineListFilter) {
    return this.listService.getMachines(user, filter);
  }

  async getMachine(
    machineId: string,
    user: CurrentUser,
    filter: MachineDetailFilter,
  ) {
    return this.listService.getMachine(machineId, user, filter);
  }

  async updateMachine(
    machineId: string,
    data: {
      machineName?: string;
      watcherEnabled?: boolean;
    },
    user: CurrentUser,
  ) {
    return this.listService.updateMachine(machineId, data, user);
  }

  async getHeartbeat(machineId: string, user: CurrentUser) {
    return this.listService.getHeartbeat(machineId, user);
  }
  // async getHeartbeat(machineId: string, user: AuthUser) {
  //   return this.heartbeatService.getHeartbeat(machineId, user);
  // }
}
