import { NextFunction, Request, Response } from "express";

import prisma from "../../config/prisma";
import { Prisma } from "../../generated/prisma/client";
import { BadRequestError } from "../errors/BadRequestError";
import { ConflictError } from "../errors/ConflictError";
import { Logger } from "../utils/logger";

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,128}$/;
const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Desktop cash writes with an `Idempotency-Key` header (a new random id per
 * user action, reused on every retry of it): a retry within 24 h for the
 * same machine gets the first answer back (header `Idempotent-Replayed:
 * true`) instead of moving cash twice.
 *
 * Only successful answers are kept; a failed one is forgotten so the retry
 * runs again. The key is claimed before the action runs, so two copies sent
 * at once can't both run (the second gets 409 while the first is running).
 * Without the header nothing changes. Runs after the header credentials, so
 * `machineCode` is in the body.
 */
export function machineIdempotency(req: Request, res: Response, next: NextFunction) {
  const key = req.get("idempotency-key")?.trim();
  const machineCode = typeof req.body?.machineCode === "string" ? req.body.machineCode : null;

  if (!key || !machineCode) {
    return next();
  }

  if (!KEY_PATTERN.test(key)) {
    throw new BadRequestError("Idempotency-Key must be 8–128 letters, digits, '-', '_', ':' or '.'.");
  }

  return claim(req, res, next, machineCode, key);
}

async function claim(req: Request, res: Response, next: NextFunction, machineCode: string, key: string) {
  const path = req.originalUrl.split("?")[0];
  const since = new Date(Date.now() - WINDOW_MS);

  await prisma.machineIdempotencyKey.deleteMany({ where: { machineCode, createdAt: { lt: since } } });

  let id: string;

  try {
    id = (
      await prisma.machineIdempotencyKey.create({
        data: { machineCode, key, method: req.method, path },
        select: { id: true },
      })
    ).id;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }

    const seen = await prisma.machineIdempotencyKey.findUnique({
      where: { machineCode_key: { machineCode, key } },
    });

    if (!seen) {
      throw new ConflictError("This request is still being processed. Try again in a moment.");
    }

    if (seen.method !== req.method || seen.path !== path) {
      throw new ConflictError(
        "Duplicate request: the same Idempotency-Key was used for a different request. Send a new key per action.",
      );
    }

    if (seen.statusCode === null) {
      throw new ConflictError("This request is still being processed. Try again in a moment.");
    }

    res.set("Idempotent-Replayed", "true");

    return res.status(seen.statusCode).json(seen.response);
  }

  let body: unknown;
  const json = res.json.bind(res);

  res.json = (value: unknown) => {
    body = value;

    return json(value);
  };

  res.on("finish", () => {
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    const save = ok
      ? prisma.machineIdempotencyKey.update({
          where: { id },
          data: {
            statusCode: res.statusCode,
            response: body === undefined ? Prisma.JsonNull : (body as Prisma.InputJsonValue),
          },
        })
      : prisma.machineIdempotencyKey.delete({ where: { id } });

    save.catch((error: Error) => Logger.error(`Idempotency-Key ${key}: ${error.message}`));
  });

  return next();
}
