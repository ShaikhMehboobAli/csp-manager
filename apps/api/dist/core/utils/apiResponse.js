"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiResponse = void 0;
class ApiResponse {
    success;
    message;
    data;
    meta;
    constructor(success, message, data, meta) {
        this.success = success;
        this.message = message;
        this.data = data;
        this.meta = meta;
    }
    static success(message, data, meta) {
        return new ApiResponse(true, message, data, meta);
    }
    static error(message, data) {
        return new ApiResponse(false, message, data);
    }
}
exports.ApiResponse = ApiResponse;
