"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcrypt_1 = __importDefault(require("bcrypt"));
class PasswordService {
    saltRounds = 10;
    async hash(password) {
        return bcrypt_1.default.hash(password, this.saltRounds);
    }
    async compare(password, hash) {
        return bcrypt_1.default.compare(password, hash);
    }
}
exports.default = PasswordService;
