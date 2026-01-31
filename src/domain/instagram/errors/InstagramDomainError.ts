export type InstagramDomainErrorCode =
  | "INVALID_INPUT"
  | "INVALID_DATE_RANGE"
  | "INVALID_TOKEN"
  | "INVALID_IG_USER_ID"
  | "DATA_INTEGRITY"
  | "RATE_LIMIT"
  | "NOT_AUTHORIZED"
  | "TEMPORARY_FAILURE";

export class InstagramDomainError extends Error {
  public readonly code: InstagramDomainErrorCode;
  public readonly details?: Record<string, unknown>;
  public readonly retryable: boolean;

  constructor(args: {
    code: InstagramDomainErrorCode;
    message: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(args.message);
    this.name = "InstagramDomainError";
    this.code = args.code;
    this.details = args.details;
    this.retryable = Boolean(args.retryable);

    if (args.cause) {
      (this as any).cause = args.cause;
    }
  }

  static invalidInput(message: string, details?: Record<string, unknown>) {
    return new InstagramDomainError({
      code: "INVALID_INPUT",
      message,
      details,
      retryable: false,
    });
  }

  static invalidDateRange(details?: Record<string, unknown>) {
    return new InstagramDomainError({
      code: "INVALID_DATE_RANGE",
      message: "Invalid date range (from/to).",
      details,
      retryable: false,
    });
  }

  static dataIntegrity(message: string, details?: Record<string, unknown>) {
    return new InstagramDomainError({
      code: "DATA_INTEGRITY",
      message,
      details,
      retryable: false,
    });
  }

  static rateLimit(details?: Record<string, unknown>) {
    return new InstagramDomainError({
      code: "RATE_LIMIT",
      message: "Rate limit reached. Try again later.",
      details,
      retryable: true,
    });
  }

  static notAuthorized(message = "Not authorized.", details?: Record<string, unknown>) {
    return new InstagramDomainError({
      code: "NOT_AUTHORIZED",
      message,
      details,
      retryable: false,
    });
  }

  static temporaryFailure(message: string, details?: Record<string, unknown>) {
    return new InstagramDomainError({
      code: "TEMPORARY_FAILURE",
      message,
      details,
      retryable: true,
    });
  }
}
