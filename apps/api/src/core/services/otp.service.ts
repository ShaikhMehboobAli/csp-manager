import { randomInt } from "crypto";

export default class OtpService {
  //   generate(length = 6): string {
  //     const max = Math.pow(10, length);
  //     const min = Math.pow(10, length - 1);

  //     return String(
  //       (crypto.getRandomValues(new Uint32Array(1))[0] % (max - min)) + min,
  //     );
  //   }

  generate(length = 6): string {
    const min = 10 ** (length - 1);
    const max = 10 ** length;

    return randomInt(min, max).toString();
  }

  getExpiry(minutes = 10): Date {
    return new Date(Date.now() + minutes * 60 * 1000);
  }
}
