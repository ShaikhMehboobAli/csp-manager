// import { PrismaClient, Prisma } from "../../generated/prisma";

import { Prisma, PrismaClient } from "../../generated/prisma/client";

// export type PrismaTransaction = Omit<
//   PrismaClient,
//   keyof PrismaClient | "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
// >;

export type PrismaTransaction = Prisma.TransactionClient;

export type PrismaDb = PrismaClient | Prisma.TransactionClient;
