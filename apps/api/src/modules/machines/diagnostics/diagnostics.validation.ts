import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-08.");

export const createDiagnosticsSchema = z
  .object({
    fromDate: day.optional(),
    toDate: day.optional(),
    note: z.string().trim().max(300).optional(),
  })
  .default({});

export const listDiagnosticsQuerySchema = z.object({
  machineId: z.string().trim().min(1).optional(),
  status: z.enum(["OPEN", "RECEIVED", "CANCELLED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const uploadDiagnosticsSchema = z.object({
  machineCode: z.string().trim().min(1),
  apiKey: z.string().optional(),
  fingerprint: z.string().trim().min(1),
  requestId: z.string().trim().min(1).max(40),
  appVersion: z.string().trim().max(30).optional(),
  part: z.number().int().min(1),
  parts: z.number().int().min(1).max(50),
  fileName: z.string().trim().min(1).max(100),
  // Size is checked in bytes by the service (413).
  content: z.string().min(1, "content is empty.").max(3 * 1024 * 1024),
});
