"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class EmailService {
    async sendOtp(email, otp) {
        console.log(`OTP for ${email}: ${otp}`);
    }
}
exports.default = EmailService;
