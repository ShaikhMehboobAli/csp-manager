import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

import { BadRequestError } from "../errors/BadRequestError";

type ValidationTarget = "body" | "query" | "params";

export const validate =
  (schema: ZodSchema, target: ValidationTarget = "body") =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      throw new BadRequestError(
        result.error.issues[0]?.message ?? "Validation failed.",
      );
    }

    if (target === "body") {
      req.body = result.data;
    } else {
      Object.assign(req[target], result.data);
    }

    next();
  };
