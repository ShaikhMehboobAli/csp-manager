import { NextFunction, Request, Response } from "express";

import prisma from "../../config/prisma";
import { runWithVerifiedMachine } from "../context/machine-context";
import { BadRequestError } from "../errors/BadRequestError";
import { verifyMachineRequest } from "../security/machine-signature";

const MACHINE_AUTH_SCHEME = "Machine ";

/**
 * Desktop calls may send their credentials as headers instead of in the body:
 *   X-Machine-Code, X-Machine-Fingerprint, Authorization: Machine <apiKey>
 * They're copied into the body so validation and services stay unchanged.
 * Body-only clients keep working. A header that contradicts the body is
 * refused. Runs before the rate limit, which keys on machineCode.
 */
export function machineHeaderCredentials(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const authorization = req.get("authorization");

  const fromHeaders = {
    machineCode: req.get("x-machine-code")?.trim(),
    fingerprint: req.get("x-machine-fingerprint")?.trim(),
    apiKey: authorization?.startsWith(MACHINE_AUTH_SCHEME)
      ? authorization.slice(MACHINE_AUTH_SCHEME.length).trim()
      : undefined,
  };

  if (
    !fromHeaders.machineCode &&
    !fromHeaders.fingerprint &&
    !fromHeaders.apiKey
  ) {
    return next();
  }

  if (req.body === undefined || req.body === null) {
    req.body = {};
  }

  if (typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new BadRequestError("Request body must be a JSON object.");
  }

  for (const [field, value] of Object.entries(fromHeaders)) {
    if (!value) {
      continue;
    }

    const inBody = req.body[field];

    if (inBody !== undefined && inBody !== value) {
      throw new BadRequestError(
        "Machine credentials in the headers and the body don't match.",
      );
    }

    req.body[field] = value;
  }

  next();
}

/**
 * Verifies X-Signature (device key) when present. On success the request
 * runs with the machine marked as verified, so machine authentication skips
 * the API key. Unsigned requests pass through; authentication decides
 * whether this machine may still use its API key.
 */
export async function verifyMachineSignature(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const signature = req.get("x-signature")?.trim();

  if (!signature) {
    return next();
  }

  const machineCode = req.body?.machineCode;

  if (typeof machineCode !== "string" || !machineCode) {
    throw new BadRequestError("Machine code is required.");
  }

  const machine = await prisma.machine.findUnique({
    where: { machineCode },
    select: { devicePublicKey: true },
  });

  if (!machine) {
    throw new BadRequestError("Machine not found.");
  }

  if (!machine.devicePublicKey) {
    throw new BadRequestError(
      "This machine has no device key. Re-activate it to register one.",
    );
  }

  verifyMachineRequest({
    publicKeyPem: machine.devicePublicKey,
    machineCode,
    method: req.method,
    path: req.originalUrl,
    timestamp: req.get("x-timestamp")?.trim(),
    nonce: req.get("x-nonce")?.trim(),
    signature,
    rawBody: req.rawBody,
  });

  runWithVerifiedMachine(machineCode, next);
}
