"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginSchema = void 0;
const zod_1 = require("zod");
const common_validator_1 = require("../../../core/validators/common.validator");
exports.loginSchema = zod_1.z.object({
    agentId: common_validator_1.agentIdValidator,
    password: common_validator_1.passwordValidator,
});
