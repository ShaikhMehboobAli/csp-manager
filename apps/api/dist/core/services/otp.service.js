"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
class OtpService {
    //   generate(length = 6): string {
    //     const max = Math.pow(10, length);
    //     const min = Math.pow(10, length - 1);
    //     return String(
    //       (crypto.getRandomValues(new Uint32Array(1))[0] % (max - min)) + min,
    //     );
    //   }
    generate(length = 6) {
        const min = 10 ** (length - 1);
        const max = 10 ** length;
        return (0, crypto_1.randomInt)(min, max).toString();
    }
    getExpiry(minutes = 10) {
        return new Date(Date.now() + minutes * 60 * 1000);
    }
}
exports.default = OtpService;
