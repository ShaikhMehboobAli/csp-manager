export default class EmailService {
  async sendOtp(email: string, otp: string) {
    console.log(`OTP for ${email}: ${otp}`);
  }
}
