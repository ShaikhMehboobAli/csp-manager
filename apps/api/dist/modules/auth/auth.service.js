"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../../config/prisma"));
const auth_repository_1 = __importDefault(require("./auth.repository"));
const email_service_1 = __importDefault(require("../../core/services/email.service"));
const otp_service_1 = __importDefault(require("../../core/services/otp.service"));
const enums_1 = require("../../generated/prisma/enums");
const password_service_1 = __importDefault(require("../../core/security/password.service"));
class AuthService {
    passwordService;
    otpService;
    emailService;
    constructor(passwordService = new password_service_1.default(), otpService = new otp_service_1.default(), emailService = new email_service_1.default()) {
        this.passwordService = passwordService;
        this.otpService = otpService;
        this.emailService = emailService;
    }
    async signup(data) {
        const repository = new auth_repository_1.default(prisma_1.default);
        // Find Agent
        const agent = await repository.findAgentByAgentId(data.agentId);
        if (!agent) {
            throw new Error("Invalid Agent ID.");
        }
        // KO cannot login
        if (agent.type === enums_1.AgentType.KO) {
            throw new Error("KO cannot create login account.");
        }
        // Determine Role
        const role = agent.type === enums_1.AgentType.BC ? enums_1.UserRole.BC_ADMIN : enums_1.UserRole.CSP_ADMIN;
        // Find existing user
        const existingUser = await repository.findUserByAgentId(data.agentId);
        console.log(role, existingUser);
        return {
            message: "Continue Signup",
        };
    }
}
exports.default = AuthService;
