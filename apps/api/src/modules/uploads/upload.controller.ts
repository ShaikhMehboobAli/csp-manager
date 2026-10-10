import { Request, Response } from "express";

import UploadService from "./upload.service";
import { BadRequestError } from "../../core/errors/BadRequestError";

export default class UploadController {
  private readonly uploadService: UploadService;

  constructor() {
    this.uploadService = new UploadService();
  }

  async createPresignedUploadUrl(req: Request, res: Response) {
    const { fileName, contentType } = req.body;

    if (!fileName || typeof fileName !== "string") {
      throw new BadRequestError("File name is required.");
    }

    if (!contentType || typeof contentType !== "string") {
      throw new BadRequestError("Content type is required.");
    }

    const result = await this.uploadService.createPresignedUploadUrl({
      fileName,
      contentType,
      //   folder,
    });

    return res.status(200).json({
      success: true,
      message: "Presigned upload URL created successfully.",
      data: result,
    });
  }

  async createPresignedDownloadUrl(req: Request, res: Response) {
    const { key } = req.query;

    if (!key || typeof key !== "string") {
      throw new BadRequestError("File key is required.");
    }

    const url = await this.uploadService.createPresignedDownloadUrl(key);

    return res.status(200).json({
      success: true,
      message: "Presigned download URL created successfully.",
      data: {
        key,
        url,
      },
    });
  }

  async deleteObject(req: Request, res: Response) {
    const { key } = req.body;

    if (!key || typeof key !== "string") {
      throw new BadRequestError("File key is required.");
    }

    await this.uploadService.deleteObject(key);

    return res.status(200).json({
      success: true,
      message: "File deleted successfully.",
    });
  }
}
