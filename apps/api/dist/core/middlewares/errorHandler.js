"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const AppError_1 = require("../errors/AppError");
const logger_1 = require("../utils/logger");
function errorHandler(err, req, res, next) {
    logger_1.Logger.error(`${req.method} ${req.originalUrl}`);
    logger_1.Logger.error(err.message);
    if (err instanceof AppError_1.AppError) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message,
        });
    }
    return res.status(500).json({
        success: false,
        message: "Internal Server Error",
    });
}
