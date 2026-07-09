"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const enums_1 = require("../../generated/prisma/enums");
class AuthRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    findAgentByAgentId(agentId) {
        return this.db.agent.findUnique({
            where: {
                agentId,
            },
        });
    }
    findUserByAgentId(agentId) {
        return this.db.user.findUnique({
            where: {
                agentId,
            },
        });
    }
    createPendingUser(data) {
        return this.db.user.create({
            data: {
                agentId: data.agentId,
                email: data.email,
                passwordHash: data.passwordHash,
                role: data.role,
                status: enums_1.UserStatus.PENDING,
                signupCompleted: false,
                isEmailVerified: false,
                isPhoneVerified: false,
            },
        });
    }
    updatePendingUser(data) {
        return this.db.user.update({
            where: {
                id: data.userId,
            },
            data: {
                email: data.email,
                passwordHash: data.passwordHash,
            },
        });
    }
    createOtp(data) {
        return this.db.otp.create({
            data,
        });
    }
    deleteUnusedOtps(userId) {
        return this.db.otp.deleteMany({
            where: {
                userId,
                isUsed: false,
            },
        });
    }
}
exports.default = AuthRepository;
