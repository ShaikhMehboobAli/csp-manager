import os from "os";

export function normalizeFingerprint(fingerprint: string) {
  return fingerprint.trim().toUpperCase();
}

export function generateMachineName() {
  return os.hostname();
}
