import { Request, Response } from "express";

import MachineService from "./machine.service";

const machineService = new MachineService();

export const activateMachine = async (req: Request, res: Response) => {
  const result = await machineService.activateMachine(req.body);

  return res.status(201).json(result);
};
