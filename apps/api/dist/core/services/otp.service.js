"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class OtpService {
    generate(length = 6) {
        const min = Math.pow(10, length - 1);
        const max = Math.pow(10, length) - 1;
        return String(Math.floor(Math.random() * (max - min + 1)) + min);
    }
    getExpiry(minutes = 10) {
        return new Date(Date.now() + minutes * 60 * 1000);
    }
}
exports.default = OtpService;
