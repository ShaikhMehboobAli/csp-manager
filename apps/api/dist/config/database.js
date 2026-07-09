"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDatabase = connectDatabase;
exports.disconnectDatabase = disconnectDatabase;
const prisma_1 = __importDefault(require("./prisma"));
async function connectDatabase() {
    try {
        await prisma_1.default.$connect();
        console.log("✅ PostgreSQL connected successfully");
    }
    catch (error) {
        console.error("❌ Database connection failed");
        console.error(error);
        process.exit(1);
    }
}
async function disconnectDatabase() {
    await prisma_1.default.$disconnect();
}
