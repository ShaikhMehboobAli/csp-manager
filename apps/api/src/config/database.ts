import prisma from "./prisma";

export async function connectDatabase() {
  try {
    await prisma.$connect();

    console.log("✅ PostgreSQL connected successfully");
  } catch (error) {
    console.error("❌ Database connection failed");
    console.error(error);

    process.exit(1);
  }
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}
