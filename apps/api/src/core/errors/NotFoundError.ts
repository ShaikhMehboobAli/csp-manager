import { AppError } from "./AppError";

export class NotFoundError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 404, code);
  }
}
