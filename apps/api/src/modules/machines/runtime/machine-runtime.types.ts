import { Prisma } from "../../../generated/prisma/client";

export type MachineWithRelations = Prisma.MachineGetPayload<{
  include: {
    activations: {
      include: {
        subscription: true;
      };
    };
  };
}>;

export type CurrentActivation = MachineWithRelations["activations"][number];

export type Subscription = CurrentActivation["subscription"];
