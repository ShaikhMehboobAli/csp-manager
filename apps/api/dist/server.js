"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const env_1 = require("./config/env");
const database_1 = require("./config/database");
const logger_1 = require("./core/utils/logger");
async function bootstrap() {
    try {
        await (0, database_1.connectDatabase)();
        app_1.default.listen(env_1.env.port, "0.0.0.0", () => {
            logger_1.Logger.success(`🚀 CSP Manager API running on port ${env_1.env.port}`);
        });
    }
    catch (error) {
        logger_1.Logger.error("Failed to start server");
        console.error(error);
        process.exit(1);
    }
}
process.on("SIGINT", async () => {
    logger_1.Logger.info("Disconnecting database...");
    await (0, database_1.disconnectDatabase)();
    process.exit(0);
});
process.on("SIGTERM", async () => {
    logger_1.Logger.info("Disconnecting database...");
    await (0, database_1.disconnectDatabase)();
    process.exit(0);
});
bootstrap();
