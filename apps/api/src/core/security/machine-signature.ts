import * as crypto from "node:crypto";

import { BadRequestError } from "../errors/BadRequestError";

/**
 * Desktop request signing with a per-machine device key (ECDSA P-256).
 *
 * At activation the desktop sends the public key (SubjectPublicKeyInfo, PEM or
 * base64 DER); the private key never leaves the PC. Each request is signed:
 *
 *   METHOD \n PATH \n TIMESTAMP \n NONCE \n SHA256_HEX(raw body)
 *
 * PATH is the full request path with query (e.g. /api/v1/receipts/upload-counts),
 * TIMESTAMP is Unix seconds, and the signature is base64 of the 64-byte
 * IEEE P1363 (r||s) value (what .NET ECDsa.SignData returns). DER is accepted too.
 */

// Requests older or newer than this are refused (clock skew + replay window).
export const SIGNATURE_MAX_SKEW_SECONDS = 300;

const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** Validates a device public key and returns it as PEM. */
export function normalizeDevicePublicKey(input: string): string {
  let key: crypto.KeyObject;

  try {
    const value = input.trim();

    key = value.startsWith("-----BEGIN")
      ? crypto.createPublicKey(value)
      : crypto.createPublicKey({
          key: Buffer.from(value, "base64"),
          format: "der",
          type: "spki",
        });
  } catch {
    throw new BadRequestError("Device public key is not a valid public key.");
  }

  if (
    key.asymmetricKeyType !== "ec" ||
    key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  ) {
    throw new BadRequestError("Device public key must be an ECDSA P-256 key.");
  }

  return key.export({ format: "pem", type: "spki" }).toString();
}

export function signingString(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  rawBody: Buffer | undefined,
) {
  const bodyHash = crypto
    .createHash("sha256")
    .update(rawBody ?? Buffer.alloc(0))
    .digest("hex");

  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

/**
 * Nonces seen within the replay window, per process. With more than one API
 * instance this must move to a shared store (pre-production checklist 5A.4).
 */
const seenNonces = new Map<string, number>();

function rememberNonce(machineCode: string, nonce: string) {
  const now = Date.now();

  if (seenNonces.size > 50_000) {
    for (const [key, expiresAt] of seenNonces) {
      if (expiresAt <= now) {
        seenNonces.delete(key);
      }
    }
  }

  const key = `${machineCode}:${nonce}`;
  const expiresAt = seenNonces.get(key);

  if (expiresAt && expiresAt > now) {
    return false;
  }

  seenNonces.set(key, now + 2 * SIGNATURE_MAX_SKEW_SECONDS * 1000);

  return true;
}

export function verifyMachineRequest(input: {
  publicKeyPem: string;
  machineCode: string;
  method: string;
  path: string;
  timestamp: string | undefined;
  nonce: string | undefined;
  signature: string;
  rawBody: Buffer | undefined;
}) {
  const { timestamp, nonce } = input;

  if (!timestamp || !/^\d{10}$/.test(timestamp)) {
    throw new BadRequestError("X-Timestamp must be Unix time in seconds.");
  }

  if (
    Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_MAX_SKEW_SECONDS
  ) {
    throw new BadRequestError(
      "Request timestamp is too old or in the future. Check the PC clock.",
    );
  }

  if (!nonce || !NONCE_PATTERN.test(nonce)) {
    throw new BadRequestError(
      "X-Nonce must be 16-64 letters, digits, '-' or '_'.",
    );
  }

  const signature = Buffer.from(input.signature, "base64");

  const data = Buffer.from(
    signingString(input.method, input.path, timestamp, nonce, input.rawBody),
  );

  let isValid = false;

  try {
    isValid = crypto.verify(
      "sha256",
      data,
      {
        key: input.publicKeyPem,
        // 64 bytes = IEEE P1363 (r||s); anything else is treated as DER.
        dsaEncoding: signature.length === 64 ? "ieee-p1363" : "der",
      },
      signature,
    );
  } catch {
    // Malformed signature bytes.
  }

  if (!isValid) {
    throw new BadRequestError("Invalid request signature.");
  }

  // Checked after the signature, so unsigned junk can't fill the cache.
  if (!rememberNonce(input.machineCode, nonce)) {
    throw new BadRequestError(
      "Request has already been used (replayed nonce).",
    );
  }
}
