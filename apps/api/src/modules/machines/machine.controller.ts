import { Request, Response } from "express";

import MachineService from "./machine.service";

import { activateMachineSchema } from "./validators/activate-machine.schema";
import { MachineParams } from "./machine.dto";
import { updateMachineSchema } from "./validators/update-machine.schema";
import { machineListQuerySchema } from "./validators/machine.validation";

const machineService = new MachineService();

export const activateMachine = async (req: Request, res: Response) => {
  const body = activateMachineSchema.parse(req.body);

  const result = await machineService.activateMachine(body);

  return res.status(201).json(result);
};

export const getMachines = async (req: Request, res: Response) => {
  const query = machineListQuerySchema.parse(req.query);

  const result = await machineService.getMachines(req.user!, query);

  return res.json({
    success: true,

    message: "Machines fetched successfully.",

    data: result,
  });
};

export const getMachine = async (req: Request, res: Response) => {
  const result = await machineService.getMachine(
    req.params.machineId as string,
    req.user!,
  );

  return res.json({
    success: true,

    message: "Machine fetched successfully.",

    data: result,
  });
};

export const updateMachine = async (req: Request, res: Response) => {
  const body = updateMachineSchema.parse(req.body);

  const result = await machineService.updateMachine(
    req.params.machineId as string,
    body,
    req.user!,
  );

  return res.json({
    success: true,

    message: "Machine updated successfully.",

    data: result,
  });
};

export const getHeartbeat = async (req: Request, res: Response) => {
  const result = await machineService.getHeartbeat(
    req.params.machineId as string,
    req.user!,
  );

  return res.json({
    success: true,

    message: "Machine heartbeat fetched successfully.",

    data: result,
  });
};
