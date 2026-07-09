import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { UserRole } from "../../generated/prisma/enums";

export interface JwtPayload {
  userId: string;
  agentId: string;
  role: UserRole;
}

class JwtService {
  generateAccessToken(payload: JwtPayload) {
    return jwt.sign(payload, env.jwtSecret, {
      expiresIn: "15m",
    });
  }

  generateRefreshToken(payload: JwtPayload) {
    return jwt.sign(payload, env.jwtRefreshSecret, {
      expiresIn: "7d",
    });
  }

  verify(token: string): JwtPayload {
    return jwt.verify(token, env.jwtSecret) as JwtPayload;
  }
}

export default JwtService;
