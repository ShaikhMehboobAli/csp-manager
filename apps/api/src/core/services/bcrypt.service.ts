import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

class BcryptService {
  /**
   * Hash plain password
   */
  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  /**
   * Compare password with hash
   */
  async compare(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}

export default BcryptService;
