"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../../config/prisma"));
const auth_repository_1 = __importDefault(require("./auth.repository"));
const bcrypt_service_1 = __importDefault(require("../../core/services/bcrypt.service"));
const email_service_1 = __importDefault(require("../../core/services/email.service"));
const otp_service_1 = __importDefault(require("../../core/services/otp.service"));
const enums_1 = require("../../generated/prisma/enums");
const transaction_1 = require("../../core/database/transaction");
const NotFoundError_1 = require("../../core/errors/NotFoundError");
const ForbiddenError_1 = require("../../core/errors/ForbiddenError");
const ConflictError_1 = require("../../core/errors/ConflictError");
const jwt_service_1 = __importDefault(require("../../core/services/jwt.service"));
const BadRequestError_1 = require("../../core/errors/BadRequestError");
class AuthService {
    bcryptService;
    otpService;
    emailService;
    jwtService;
    repository;
    constructor(bcryptService = new bcrypt_service_1.default(), otpService = new otp_service_1.default(), emailService = new email_service_1.default(), jwtService = new jwt_service_1.default()) {
        this.bcryptService = bcryptService;
        this.otpService = otpService;
        this.emailService = emailService;
        this.jwtService = jwtService;
        this.repository = new auth_repository_1.default(prisma_1.default);
    }
    async signup(data) {
        // Validate Agent
        // const agent = await this.repository.findAgentByAgentId(data.agentId);
        // if (!agent) {
        //   return this.signupNewAgent(data);
        // }
        // return this.signupExistingAgent(agent, data);
        switch (data.accountType) {
            case enums_1.AgentType.BC:
                return this.signupBusinessCorrespondent(data);
            case enums_1.AgentType.CSP:
                return this.signupCSP(data);
            default:
                throw new BadRequestError_1.BadRequestError("Invalid account type.");
        }
    }
    //old
    // private async signupBusinessCorrespondent(data: SignupDto) {
    //   const existingBC = await this.repository.findBusinessCorrespondentByBcId(
    //     data.agentId,
    //   );
    //   if (existingBC) {
    //     return this.signupExistingBusinessCorrespondent(existingBC, data);
    //   }
    //   return this.signupNewBusinessCorrespondent(data);
    // }
    //working
    async signupBusinessCorrespondent(data) {
        return (0, transaction_1.withTransaction)(async (tx) => {
            const repository = new auth_repository_1.default(tx);
            await this.createBusinessCorrespondentIfNeeded(repository, data);
            const user = await this.createPendingAccount(repository, {
                agentId: data.agentId,
                email: data.email,
                phone: data.phone,
                password: data.password,
                role: enums_1.UserRole.BC_ADMIN,
            });
            return {
                success: true,
                message: "Signup successful. OTP sent for verification.",
                data: {
                    userId: user.id,
                },
            };
        });
    }
    //old
    // private async signupCSP(data: SignupDto) {
    //   const agent = await this.repository.findAgentByAgentId(data.agentId);
    //   if (!agent) {
    //     return this.signupNewAgent(data);
    //   }
    //   return this.signupExistingAgent(agent, data);
    // }
    // working
    async signupCSP(data) {
        return (0, transaction_1.withTransaction)(async (tx) => {
            const repository = new auth_repository_1.default(tx);
            await this.createAgentIfNeeded(repository, data);
            const user = await this.createPendingAccount(repository, {
                agentId: data.agentId,
                email: data.email,
                phone: data.phone,
                password: data.password,
                role: enums_1.UserRole.CSP_ADMIN,
            });
            return {
                success: true,
                message: "Signup successful. OTP sent for verification.",
                data: {
                    userId: user.id,
                },
            };
        });
    }
    // private async signupNewBusinessCorrespondent(data: SignupDto) {
    //   const passwordHash = await this.bcryptService.hash(data.password);
    //   const otpCode = this.otpService.generate();
    //   const expiresAt = this.otpService.getExpiry();
    //   const user = await withTransaction(async (tx) => {
    //     const repository = new AuthRepository(tx);
    //     await repository.createBusinessCorrespondent({
    //       bcId: data.agentId,
    //       name: data.name,
    //       email: data.email,
    //       phone: data.phone,
    //       address: data.address,
    //     });
    //     const currentUser = await repository.createPendingUser({
    //       agentId: data.agentId,
    //       email: data.email,
    //       passwordHash,
    //       role: UserRole.BC_ADMIN,
    //     });
    //     await repository.createOtp({
    //       userId: currentUser.id,
    //       otpCode,
    //       purpose: OtpPurpose.SIGNUP,
    //       email: data.email,
    //       phone: data.phone,
    //       expiresAt,
    //     });
    //     return currentUser;
    //   });
    //   await this.emailService.sendOtp(data.email, otpCode);
    //   return {
    //     success: true,
    //     message: "OTP sent successfully.",
    //     data: {
    //       userId: user.id,
    //     },
    //   };
    // }
    // private async signupExistingBusinessCorrespondent(
    //   bc: BusinessCorrespondent,
    //   data: SignupDto,
    // ) {
    //   const passwordHash = await this.bcryptService.hash(data.password);
    //   const otpCode = this.otpService.generate();
    //   const expiresAt = this.otpService.getExpiry();
    //   const user = await withTransaction(async (tx) => {
    //     const repository = new AuthRepository(tx);
    //     const existingUser = await repository.findUserByAgentId(bc.bcId);
    //     let currentUser;
    //     if (!existingUser) {
    //       currentUser = await repository.createPendingUser({
    //         agentId: bc.bcId,
    //         email: data.email,
    //         passwordHash,
    //         role: UserRole.BC_ADMIN,
    //       });
    //     } else {
    //       if (existingUser.status === UserStatus.ACTIVE) {
    //         throw new ConflictError("Account already exists. Please login.");
    //       }
    //       currentUser = await repository.updatePendingUser({
    //         userId: existingUser.id,
    //         email: data.email,
    //         passwordHash,
    //       });
    //     }
    //     await repository.deleteUnusedOtps(currentUser.id);
    //     await repository.createOtp({
    //       userId: currentUser.id,
    //       otpCode,
    //       purpose: OtpPurpose.SIGNUP,
    //       email: data.email,
    //       phone: data.phone,
    //       expiresAt,
    //     });
    //     return currentUser;
    //   });
    //   await this.emailService.sendOtp(data.email, otpCode);
    //   return {
    //     success: true,
    //     message: "OTP sent successfully.",
    //     data: {
    //       userId: user.id,
    //     },
    //   };
    // }
    //working
    async createBusinessCorrespondentIfNeeded(repository, data) {
        // Create BC if it doesn't exist
        const existingBC = await repository.findBusinessCorrespondentByBcId(data.agentId);
        if (!existingBC) {
            await repository.createBusinessCorrespondent({
                bcId: data.agentId,
                name: data.name,
                email: data.email,
                phone: data.phone,
                address: data.address,
            });
        }
        // Create Agent if it doesn't exist
        const existingAgent = await repository.findAgentByAgentId(data.agentId);
        if (!existingAgent) {
            await repository.createAgent({
                agentId: data.agentId,
                name: data.name,
                type: enums_1.AgentType.BC,
                email: data.email,
                mobile: data.phone,
                address: data.address,
                bcId: data.agentId,
                selfRegistered: true,
                isProfileCompleted: true,
            });
        }
    }
    async createAgentIfNeeded(repository, data) {
        const existing = await repository.findAgentByAgentId(data.agentId);
        if (existing) {
            if (existing.type === enums_1.AgentType.KO) {
                throw new ForbiddenError_1.ForbiddenError("KO cannot create login account.");
            }
            await repository.updateAgent(existing.agentId, {
                name: data.name,
                email: data.email,
                mobile: data.phone,
                address: data.address,
                selfRegistered: true,
                isProfileCompleted: true,
            });
            return;
        }
        await repository.createAgent({
            agentId: data.agentId,
            name: data.name,
            type: enums_1.AgentType.CSP,
            email: data.email,
            mobile: data.phone,
            address: data.address,
            selfRegistered: true,
        });
    }
    async checkAgent(data) {
        const repository = new auth_repository_1.default(prisma_1.default);
        const agent = await repository.findAgentByAgentId(data.agentId);
        if (!agent) {
            throw new NotFoundError_1.NotFoundError("Agent not found.");
        }
        if (agent.type === enums_1.AgentType.KO) {
            throw new ForbiddenError_1.ForbiddenError("KO cannot create login account.");
        }
        return {
            message: "Agent found",
            data: agent,
        };
    }
    // private async signupNewAgent(data: SignupDto) {
    //   return withTransaction(async (tx) => {
    //     const repository = new AuthRepository(tx);
    //     // Create Agent
    //     const agent = await repository.createAgent({
    //       agentId: data.agentId,
    //       name: data.name,
    //       type: data.accountType === "BC" ? AgentType.BC : AgentType.CSP,
    //       email: data.email,
    //       mobile: data.phone,
    //       address: data.address,
    //       selfRegistered: true,
    //     });
    //     // Create Pending User + OTP
    //     const user = await this.createPendingAccount(repository, agent, data);
    //     return {
    //       success: true,
    //       message: "Signup successful. OTP sent for verification.",
    //       data: {
    //         userId: user.id,
    //       },
    //     };
    //   });
    // }
    // private async signupExistingAgent(agent: Agent, data: SignupDto) {
    //   if (agent.type === AgentType.KO) {
    //     throw new ForbiddenError("KO cannot create login account.");
    //   }
    //   return withTransaction(async (tx) => {
    //     const repository = new AuthRepository(tx);
    //     // Update Agent Profile
    //     await repository.updateAgent(agent.agentId, {
    //       name: data.name,
    //       email: data.email,
    //       mobile: data.phone,
    //       address: data.address,
    //       selfRegistered: true,
    //       isProfileCompleted: true,
    //     });
    //     const updatedAgent = await repository.findAgentByAgentId(agent.agentId);
    //     if (!updatedAgent) {
    //       throw new NotFoundError("Agent not found after update.");
    //     }
    //     const user = await this.createPendingAccount(
    //       repository,
    //       updatedAgent,
    //       data,
    //     );
    //     return {
    //       success: true,
    //       message: "Signup successful. OTP sent for verification.",
    //       data: {
    //         userId: user.id,
    //       },
    //     };
    //   });
    // }
    // old
    // private async createPendingAccount(
    //   repository: AuthRepository,
    //   agent: Agent,
    //   data: SignupDto,
    // ) {
    //   // Hash Password
    //   const passwordHash = await this.bcryptService.hash(data.password);
    //   // Generate OTP
    //   const otpCode = this.otpService.generate();
    //   const expiresAt = this.otpService.getExpiry();
    //   // Check existing user
    //   const existingUser = await repository.findUserByAgentId(agent.agentId);
    //   let currentUser;
    //   if (!existingUser) {
    //     currentUser = await repository.createPendingUser({
    //       agentId: agent.agentId,
    //       email: data.email,
    //       passwordHash,
    //       role:
    //         agent.type === AgentType.BC ? UserRole.BC_ADMIN : UserRole.CSP_ADMIN,
    //     });
    //   } else {
    //     if (existingUser.status === UserStatus.ACTIVE) {
    //       throw new ConflictError("Account already exists. Please login.");
    //     }
    //     currentUser = await repository.updatePendingUser({
    //       userId: existingUser.id,
    //       email: data.email,
    //       passwordHash,
    //     });
    //   }
    //   await repository.deleteUnusedOtps(currentUser.id);
    //   await repository.createOtp({
    //     userId: currentUser.id,
    //     otpCode,
    //     purpose: OtpPurpose.SIGNUP,
    //     email: data.email,
    //     phone: data.phone,
    //     expiresAt,
    //   });
    //   await this.emailService.sendOtp(data.email, otpCode);
    //   return currentUser;
    // }
    // working
    async createPendingAccount(repository, input) {
        const passwordHash = await this.bcryptService.hash(input.password);
        const otpCode = this.otpService.generate();
        const expiresAt = this.otpService.getExpiry();
        const existingUser = await repository.findUserByAgentId(input.agentId);
        let currentUser;
        if (!existingUser) {
            currentUser = await repository.createPendingUser({
                agentId: input.agentId,
                email: input.email,
                passwordHash,
                role: input.role,
            });
        }
        else {
            if (existingUser.status === enums_1.UserStatus.ACTIVE) {
                throw new ConflictError_1.ConflictError("Account already exists. Please login.");
            }
            currentUser = await repository.updatePendingUser({
                userId: existingUser.id,
                email: input.email,
                passwordHash,
            });
        }
        await repository.deleteUnusedOtps(currentUser.id);
        await repository.createOtp({
            userId: currentUser.id,
            otpCode,
            purpose: enums_1.OtpPurpose.SIGNUP,
            email: input.email,
            phone: input.phone,
            expiresAt,
        });
        await this.sendSignupOtp(input.email, otpCode);
        return currentUser;
    }
    async sendSignupOtp(email, otpCode) {
        await this.emailService.sendOtp(email, otpCode);
    }
    async verifyOtp(data) {
        return (0, transaction_1.withTransaction)(async (tx) => {
            const repository = new auth_repository_1.default(tx);
            // 1. Find User
            const user = await repository.findUserByAgentId(data.agentId);
            if (!user) {
                throw new NotFoundError_1.NotFoundError("User not found.");
            }
            // 2. Find Latest OTP
            const otp = await repository.findLatestSignupOtp(user.id);
            if (!otp) {
                throw new NotFoundError_1.NotFoundError("OTP not found. Please request a new OTP.");
            }
            // 3. Check Expiry
            const now = new Date();
            if (otp.expiresAt < now) {
                await repository.deleteOtp(otp.id);
                throw new ConflictError_1.ConflictError("OTP has expired. Please request a new OTP.");
            }
            // 4. Check Attempts
            if (otp.attempts >= 5) {
                await repository.deleteOtp(otp.id);
                throw new ConflictError_1.ConflictError("Maximum OTP attempts exceeded. Please request a new OTP.");
            }
            // 5. Validate OTP
            if (otp.otpCode !== data.otp) {
                const attempts = otp.attempts + 1;
                if (attempts >= 5) {
                    await repository.deleteOtp(otp.id);
                    throw new ConflictError_1.ConflictError("Maximum OTP attempts exceeded. Please request a new OTP.");
                }
                await repository.updateOtpAttempts(otp.id, attempts);
                throw new ConflictError_1.ConflictError("Invalid OTP.");
            }
            // 6. Activate User
            await repository.activateUser(user.id);
            // 7. Delete OTP
            await repository.deleteOtp(otp.id);
            return {
                success: true,
                message: "OTP verified successfully.",
            };
        });
    }
    async login(data) {
        const user = await this.repository.findUserByAgentId(data.agentId);
        if (!user) {
            throw new NotFoundError_1.NotFoundError("User not found.");
        }
        if (user.status === enums_1.UserStatus.PENDING) {
            throw new ForbiddenError_1.ForbiddenError("Please verify your account first.");
        }
        const passwordMatched = await this.bcryptService.compare(data.password, user.passwordHash);
        if (!passwordMatched) {
            throw new ForbiddenError_1.ForbiddenError("Invalid credentials.");
        }
        const accessToken = this.jwtService.generateAccessToken({
            userId: user.id,
            agentId: user.agentId,
            role: user.role,
        });
        const refreshToken = this.jwtService.generateRefreshToken({
            userId: user.id,
            agentId: user.agentId,
            role: user.role,
        });
        return (0, transaction_1.withTransaction)(async (tx) => {
            const repository = new auth_repository_1.default(tx);
            await repository.updateLastLogin(user.id);
            return {
                success: true,
                message: "Login successful.",
                data: {
                    accessToken,
                    refreshToken,
                    user: {
                        id: user.id,
                        agentId: user.agentId,
                        email: user.email,
                        role: user.role,
                    },
                },
            };
        });
    }
}
exports.default = AuthService;
