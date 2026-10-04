"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../../config/env");
class JwtService {
    generateAccessToken(payload) {
        return jsonwebtoken_1.default.sign(payload, env_1.env.jwtSecret, {
            expiresIn: "15m",
        });
    }
    generateRefreshToken(payload) {
        return jsonwebtoken_1.default.sign(payload, env_1.env.jwtRefreshSecret, {
            expiresIn: "7d",
        });
    }
    verify(token) {
        return jsonwebtoken_1.default.verify(token, env_1.env.jwtSecret);
    }
}
exports.default = JwtService;
