import app from "./app";
import { env } from "./config/env";
import { connectDatabase, disconnectDatabase } from "./config/database";
import { Logger } from "./core/utils/logger";

async function bootstrap() {
  try {
    await connectDatabase();

    app.listen(env.port, "0.0.0.0", () => {
      Logger.success(`🚀 CSP Manager API running on port ${env.port}`);
    });
  } catch (error) {
    Logger.error("Failed to start server");
    console.error(error);
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  Logger.info("Disconnecting database...");
  await disconnectDatabase();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  Logger.info("Disconnecting database...");
  await disconnectDatabase();
  process.exit(0);
});

bootstrap();
