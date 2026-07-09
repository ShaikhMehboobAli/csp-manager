"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcrypt_1 = __importDefault(require("bcrypt"));
const SALT_ROUNDS = 12;
class BcryptService {
    /**
     * Hash plain password
     */
    async hash(password) {
        return bcrypt_1.default.hash(password, SALT_ROUNDS);
    }
    /**
     * Compare password with hash
     */
    async compare(password, hash) {
        return bcrypt_1.default.compare(password, hash);
    }
}
exports.default = new BcryptService();
