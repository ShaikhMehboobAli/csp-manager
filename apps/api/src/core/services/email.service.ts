export default class EmailService {
  async sendOtp(email: string, otp: string) {
    console.log(`OTP for ${email}: ${otp}`);
  }

  /**
   * Activation code + password for an agent. Stub until the email provider
   * is set up (pre-production checklist): the password is not logged; in
   * development it can be read from GET /activations (activationPassword).
   */
  async sendActivation(email: string, input: { activationCode: string; password: string; agentId: string }) {
    void input.password;
    console.log(`Activation code ${input.activationCode} for ${input.agentId} emailed to ${email}`);
  }
}
