"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signupSchema = void 0;
const zod_1 = require("zod");
const common_validator_1 = require("../../../core/validators/common.validator");
exports.signupSchema = zod_1.z
    .object({
    accountType: common_validator_1.accountTypeValidator,
    name: common_validator_1.nameValidator,
    agentId: common_validator_1.agentIdValidator,
    email: common_validator_1.emailValidator,
    phone: common_validator_1.phoneValidator,
    address: common_validator_1.addressValidator,
    password: common_validator_1.passwordValidator,
    confirmPassword: common_validator_1.passwordValidator,
})
    .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
});
