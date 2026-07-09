import { PrismaDb } from "../database/prisma.types";

import RunningNumberRepository from "../repositories/running-number.repository";

import CodeGeneratorService from "./code-generator.service";

export function createCodeGeneratorService(db: PrismaDb) {
  const runningNumberRepository = new RunningNumberRepository(db);

  return new CodeGeneratorService(runningNumberRepository);
}
