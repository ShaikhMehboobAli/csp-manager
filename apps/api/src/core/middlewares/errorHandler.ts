import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/AppError";
import { errorCodeOf } from "../errors/error-codes";
import { Logger } from "../utils/logger";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  Logger.error(`${req.method} ${req.originalUrl}`);
  Logger.error(err.message);

  // schema.parse() in controllers throws ZodError; that's a client error.
  if (err instanceof ZodError) {
    const message = err.issues[0]?.message ?? "Validation failed.";

    return res.status(400).json({
      success: false,
      code: errorCodeOf(message, 400, undefined, "VALIDATION_FAILED"),
      message,
    });
  }

  // express.json() errors: malformed JSON (400) or a body over the limit (413).
  const bodyError = err as Error & { type?: string; status?: number };

  if (bodyError.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      code: "INVALID_JSON",
      message: "Request body is not valid JSON.",
    });
  }

  if (bodyError.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body is too large.",
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      code: errorCodeOf(err.message, err.statusCode, err.code),
      message: err.message,
      ...(err.details && { details: err.details }),
    });
  }

  return res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "Internal Server Error",
  });
}
