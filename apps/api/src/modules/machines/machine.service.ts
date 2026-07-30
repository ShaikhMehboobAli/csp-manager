import MachineActivationService from "./services/machine-activation.service";

import { ActivateMachineInput } from "./types/service.types";

export default class MachineService {
  private readonly activationService = new MachineActivationService();

  async activateMachine(data: ActivateMachineInput) {
    return this.activationService.activate(data);
  }
}
