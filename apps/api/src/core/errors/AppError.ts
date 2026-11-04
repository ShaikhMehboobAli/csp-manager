export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    /** Stable code for clients; derived from the message when not given. */
    public readonly code?: string,
  ) {
    super(message);
  }
}
