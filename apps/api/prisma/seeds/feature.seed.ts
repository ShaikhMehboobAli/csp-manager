import prisma from "../../src/config/prisma";
import { features } from "./data/plans";

export async function seedFeatures() {
  for (const feature of features) {
    await prisma.feature.upsert({
      where: {
        code: feature.code,
      },
      update: {
        name: feature.name,
        description: feature.description,
        category: feature.category,
        isActive: true,
        isDeleted: false,
      },
      create: feature,
    });
  }
}
