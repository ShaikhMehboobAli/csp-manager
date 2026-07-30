import MachineActivationService from "./services/machine-activation.service";
import { ActivateMachineInput } from "./types/service.types";

export default class MachineService {
  async activateMachine(data: ActivateMachineInput) {
    const activationService = new MachineActivationService();

    return activationService.activate(data);
  }
}
