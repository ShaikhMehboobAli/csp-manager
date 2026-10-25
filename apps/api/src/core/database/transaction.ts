import prisma from "../../config/prisma";
import { PrismaDb } from "./prisma.types";

/**
 * Prisma's default interactive-transaction limits (2s wait, 5s run) are too
 * tight for a remote database: multi-receipt uploads make many sequential
 * round trips and were aborted mid-way (P2028).
 */
const TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 15_000,
};

export async function withTransaction<T>(
  callback: (tx: PrismaDb) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    return callback(tx as PrismaDb);
  }, TRANSACTION_OPTIONS);
}

/**
 * Read-only work runs on the pooled client. An interactive transaction pins a
 * single connection, so Promise.all queries inside it run one after another
 * and BEGIN/COMMIT add two round trips; reads need neither.
 */
export async function withReadOnly<T>(
  callback: (db: PrismaDb) => Promise<T>,
): Promise<T> {
  return callback(prisma);
}
