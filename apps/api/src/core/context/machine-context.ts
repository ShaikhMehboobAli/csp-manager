import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request context, set by verifyMachineSignature once a desktop request's
 * device-key signature checks out. Machine authentication then trusts the
 * signature instead of an API key for that machine code.
 */
const storage = new AsyncLocalStorage<{ verifiedMachineCode: string }>();

export function runWithVerifiedMachine<T>(
  machineCode: string,
  callback: () => T,
): T {
  return storage.run({ verifiedMachineCode: machineCode }, callback);
}

export function getVerifiedMachineCode(): string | undefined {
  return storage.getStore()?.verifiedMachineCode;
}
