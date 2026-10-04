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
    createAgent(data) {
        return this.db.agent.create({
            data,
        });
    }
    updateAgent(agentId, data) {
        return this.db.agent.update({
            where: {
                agentId,
            },
            data,
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
                purpose: enums_1.OtpPurpose.SIGNUP,
            },
        });
    }
    async findBusinessCorrespondentByBcId(bcId) {
        return this.db.businessCorrespondent.findUnique({
            where: {
                bcId,
            },
        });
    }
    async createBusinessCorrespondent(data) {
        return this.db.businessCorrespondent.create({
            data: {
                bcId: data.bcId,
                name: data.name,
                email: data.email,
                mobile: data.phone,
                address: data.address,
            },
        });
    }
    findLatestSignupOtp(userId) {
        return this.db.otp.findFirst({
            where: {
                userId,
                purpose: enums_1.OtpPurpose.SIGNUP,
            },
            orderBy: {
                createdAt: "desc",
            },
        });
    }
    incrementOtpAttempts(id, attempts) {
        return this.db.otp.update({
            where: {
                id,
            },
            data: {
                attempts,
            },
        });
    }
    activateUser(userId) {
        return this.db.user.update({
            where: {
                id: userId,
            },
            data: {
                status: enums_1.UserStatus.ACTIVE,
                isEmailVerified: true,
                signupCompleted: true,
            },
        });
    }
    deleteOtp(id) {
        return this.db.otp.delete({
            where: {
                id,
            },
        });
    }
    updateOtpAttempts(id, attempts) {
        return this.db.otp.update({
            where: {
                id,
            },
            data: {
                attempts,
            },
        });
    }
    findLoginUser(agentId) {
        return this.db.user.findUnique({
            where: {
                agentId,
            },
        });
    }
    updateLastLogin(userId) {
        return this.db.user.update({
            where: {
                id: userId,
            },
            data: {
                lastLoginAt: new Date(),
            },
        });
    }
}
exports.default = AuthRepository;
