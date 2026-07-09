import prisma from "../../config/prisma";
import { PrismaDb } from "./prisma.types";

export async function withTransaction<T>(
  callback: (tx: PrismaDb) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    return callback(tx as PrismaDb);
  });
}
