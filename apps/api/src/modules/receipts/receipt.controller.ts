import { Request, Response } from "express";

import ReceiptService from "./receipt.service";

export default class ReceiptController {
  private readonly service = new ReceiptService();

  async upload(req: Request, res: Response) {
    const result = await this.service.upload(req.body);

    return res.status(201).json(result);
  }
}
