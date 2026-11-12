import { CurrentUser } from "./auth.types";

declare global {
  namespace Express {
    interface Request {
      user?: CurrentUser;

      // Exact request bytes, for desktop request signatures.
      rawBody?: Buffer;
    }
  }
}

export {};
