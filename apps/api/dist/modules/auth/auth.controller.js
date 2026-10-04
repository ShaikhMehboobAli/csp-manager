"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = exports.verifyOtp = exports.signup = exports.checkAgent = void 0;
const auth_service_1 = __importDefault(require("./auth.service"));
const authService = new auth_service_1.default();
const checkAgent = async (req, res) => {
    const result = await authService.checkAgent(req.body);
    return res.status(200).json(result);
};
exports.checkAgent = checkAgent;
const signup = async (req, res) => {
    const result = await authService.signup(req.body);
    return res.status(201).json(result);
};
exports.signup = signup;
const verifyOtp = async (req, res) => {
    const result = await authService.verifyOtp(req.body);
    return res.status(200).json(result);
};
exports.verifyOtp = verifyOtp;
const login = async (req, res) => {
    const result = await authService.login(req.body);
    return res.status(200).json(result);
};
exports.login = login;
