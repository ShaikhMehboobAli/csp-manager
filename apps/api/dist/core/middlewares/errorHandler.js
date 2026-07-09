"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = void 0;
const appError_1 = require("../utils/appError");
const apiResponse_1 = require("../utils/apiResponse");
const logger_1 = require("../utils/logger");
const errorHandler = (err, req, res, next) => {
    if (err instanceof appError_1.AppError) {
        logger_1.Logger.warn(`${req.method} ${req.originalUrl} - ${err.message}`);
        return res.status(err.statusCode).json(apiResponse_1.ApiResponse.error(err.message));
    }
    logger_1.Logger.error(`${req.method} ${req.originalUrl}`);
    logger_1.Logger.error(err.stack || err.message);
    return res.status(500).json(apiResponse_1.ApiResponse.error("Internal Server Error"));
};
exports.errorHandler = errorHandler;
