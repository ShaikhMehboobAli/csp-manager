import { AppError } from "./AppError";

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", code?: string) {
    super(message, 401, code);
  }
}
