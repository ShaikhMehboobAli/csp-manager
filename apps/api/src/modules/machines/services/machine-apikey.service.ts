import crypto from "crypto";

export default class MachineApiKeyService {
  generateApiKey() {
    const apiKey = `mk_live_${crypto.randomBytes(32).toString("hex")}`;

    const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

    const issuedAt = new Date();

    const expiresAt = new Date();

    // 1 Year
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    return {
      apiKey,
      apiKeyHash,
      issuedAt,
      expiresAt,
    };
  }
}
