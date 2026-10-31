import { Request, Response } from "express";

import DesktopSettingsService from "./desktop-settings.service";

const service = new DesktopSettingsService();

export const getDesktopSettings = async (_req: Request, res: Response) => {
  const data = await service.getSettings();

  return res.status(200).json({
    success: true,
    message: "Desktop settings fetched successfully.",
    data,
  });
};

export const updateDesktopSettings = async (req: Request, res: Response) => {
  const data = await service.updateSettings(req.body, req.user!.userId);

  return res.status(200).json({
    success: true,
    message: "Desktop settings updated successfully.",
    data,
  });
};

export const getMachineDesktopControls = async (
  req: Request,
  res: Response,
) => {
  const data = await service.getMachineControls(
    req.params.machineCode as string,
  );

  return res.status(200).json({
    success: true,
    message: "Machine desktop controls fetched successfully.",
    data,
  });
};

export const updateMachineDesktopControls = async (
  req: Request,
  res: Response,
) => {
  const data = await service.updateMachineControls(
    req.params.machineCode as string,
    req.body.desktopControls,
    req.user!.userId,
  );

  return res.status(200).json({
    success: true,
    message: "Machine desktop controls updated successfully.",
    data,
  });
};
