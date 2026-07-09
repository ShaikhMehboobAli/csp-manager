"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFound = void 0;
const appError_1 = require("../utils/appError");
const notFound = (req, res, next) => {
    next(new appError_1.AppError(`Route ${req.method} ${req.originalUrl} not found`, 404));
};
exports.notFound = notFound;
