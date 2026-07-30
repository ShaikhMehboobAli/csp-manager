import { Request, Response } from "express";

import MachineService from "./machine.service";

import { activateMachineSchema } from "./validators/activate-machine.schema";

const machineService = new MachineService();

export const activateMachine = async (req: Request, res: Response) => {
  const body = activateMachineSchema.parse(req.body);

  const result = await machineService.activateMachine(body);

  return res.status(201).json(result);
};
