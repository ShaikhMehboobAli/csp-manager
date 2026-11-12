import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { UserRole } from "../../generated/prisma/enums";

export interface JwtPayload {
  userId: string;
  agentId: string;
  role: UserRole;
}

/** A refresh token also names its session (UserSession.id). */
export interface RefreshPayload extends JwtPayload {
  sid: string;
}

export const REFRESH_TOKEN_DAYS = 7;

class JwtService {
  generateAccessToken(payload: JwtPayload) {
    return jwt.sign(payload, env.jwtSecret, {
      expiresIn: "15m",
    });
  }

  generateRefreshToken(payload: RefreshPayload) {
    // A random id: two tokens issued in the same second still differ, so
    // rotation can tell the old one from the new one.
    return jwt.sign(payload, env.jwtRefreshSecret, {
      expiresIn: `${REFRESH_TOKEN_DAYS}d`,
      jwtid: randomUUID(),
    });
  }

  verifyRefresh(token: string): RefreshPayload {
    return jwt.verify(token, env.jwtRefreshSecret) as RefreshPayload;
  }

  verify(token: string): JwtPayload {
    return jwt.verify(token, env.jwtSecret) as JwtPayload;
  }
}

export default JwtService;
