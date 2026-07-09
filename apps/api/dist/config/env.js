"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.env = {
    port: Number(process.env.PORT) || 3000,
    nodeEnv: process.env.NODE_ENV || "development",
    apiPrefix: process.env.API_PREFIX || "/api/v1",
    databaseUrl: process.env.DATABASE_URL || "",
    logLevel: process.env.LOG_LEVEL || "debug",
    jwtSecret: process.env.JWT_SECRET || "",
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "",
    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
};
