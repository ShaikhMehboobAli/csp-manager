import bcrypt from "bcrypt";
import crypto from "crypto";

class ActivationPasswordService {
  generatePassword(length = 12) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let password = "";

    while (password.length < length) {
      const randomIndex = crypto.randomInt(0, chars.length);

      password += chars[randomIndex];
    }

    return `${password.slice(0, 4)}-${password.slice(
      4,
      8,
    )}-${password.slice(8, 12)}`;
  }

  async hash(password: string) {
    return bcrypt.hash(password, 10);
  }

  async verify(password: string, hash: string) {
    return bcrypt.compare(password, hash);
  }

  async generateCredentials() {
    const password = this.generatePassword();

    const hash = await this.hash(password);

    return {
      password,
      hash,
    };
  }
}

export default ActivationPasswordService;
