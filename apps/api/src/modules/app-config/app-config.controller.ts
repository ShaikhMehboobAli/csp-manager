import { Request, Response } from "express";

import AppConfigService from "./app-config.service";
import { appConfigQuerySchema } from "./app-config.validation";

export const getAppConfig = async (req: Request, res: Response) => {
  const { platform, version } = appConfigQuerySchema.parse(req.query);
  const data = await new AppConfigService().forApp(platform, version);

  res.set("Cache-Control", "public, max-age=3600");

  return res.status(200).json({ success: true, message: "App config fetched successfully.", data });
};

export const getAdminAppConfig = async (_req: Request, res: Response) => {
  const data = await new AppConfigService().get({ fresh: true });

  return res.status(200).json({ success: true, message: "App config fetched successfully.", data });
};

export const updateAdminAppConfig = async (req: Request, res: Response) => {
  const data = await new AppConfigService().update(req.body, req.user!.userId);

  return res.status(200).json({ success: true, message: "App config updated.", data });
};
