export class ApiResponse<T = unknown> {
  constructor(
    public success: boolean,
    public message: string,
    public data?: T,
    public meta?: unknown,
  ) {}

  static success<T>(message: string, data?: T, meta?: unknown) {
    return new ApiResponse(true, message, data, meta);
  }

  static error(message: string, data?: unknown) {
    return new ApiResponse(false, message, data);
  }
}
