export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    /** Stable code for clients; derived from the message when not given. */
    public readonly code?: string,
    /** Extra fields for the client (e.g. { retryAfterSeconds }); sent as `details`. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
