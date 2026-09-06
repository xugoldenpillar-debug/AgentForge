export const ERROR_CODES = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  CHALLENGE_NOT_FOUND: 'CHALLENGE_NOT_FOUND',
  BUILD_NOT_FOUND: 'BUILD_NOT_FOUND',
  VERSION_NOT_FOUND: 'VERSION_NOT_FOUND',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  OWNERSHIP_FORBIDDEN: 'OWNERSHIP_FORBIDDEN',
  ACCESS_FORBIDDEN: 'ACCESS_FORBIDDEN',
  BUILD_VERSION_CONFLICT: 'BUILD_VERSION_CONFLICT',
  CONCURRENT_SAVE: 'CONCURRENT_SAVE',
  FAILURE_ALREADY_SUBMITTED: 'FAILURE_ALREADY_SUBMITTED',
  REQUEST_CONTENT_TYPE_INVALID: 'REQUEST_CONTENT_TYPE_INVALID',
  REQUEST_BODY_REQUIRED: 'REQUEST_BODY_REQUIRED',
  REQUEST_BODY_TOO_LARGE: 'REQUEST_BODY_TOO_LARGE',
  INVALID_JSON_BODY: 'INVALID_JSON_BODY',
  REQUEST_VALIDATION_FAILED: 'REQUEST_VALIDATION_FAILED',
  INVALID_WORKFLOW: 'INVALID_WORKFLOW',
  PROVIDER_CONFIGURATION_INVALID: 'PROVIDER_CONFIGURATION_INVALID',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  PROVIDER_NOT_FOUND: 'PROVIDER_NOT_FOUND',
  PROVIDER_NETWORK_REJECTED: 'PROVIDER_NETWORK_REJECTED',
  PROVIDER_REQUEST_FAILED: 'PROVIDER_REQUEST_FAILED',
  PROVIDER_RESPONSE_INVALID: 'PROVIDER_RESPONSE_INVALID',
  PROVIDER_CONSENT_REQUIRED: 'PROVIDER_CONSENT_REQUIRED',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  RUN_ALREADY_ACTIVE: 'RUN_ALREADY_ACTIVE',
  RUN_CANCELLED: 'RUN_CANCELLED',
  ENDPOINT_NOT_FOUND: 'ENDPOINT_NOT_FOUND',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR'
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

export class AppError extends Error {
  status: number;
  readonly code?: ErrorCode;

  constructor(message: string, status = 400, code?: ErrorCode) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export function ensure(condition: unknown, message: string, status = 400, code?: ErrorCode): asserts condition {
  if (!condition) throw new AppError(message, status, code);
}

export function withErrorCode<T>(code: ErrorCode, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof AppError && !error.code) throw new AppError(error.message, error.status, code);
    throw error;
  }
}

export interface SafeError {
  code: ErrorCode;
  message: string;
  status: number;
}

const SAFE_GENERIC_MESSAGE = 'The request could not be completed. Check your configuration and try again.';

export function safeError(error: unknown): SafeError {
  // Never serialize a provider exception, request, response, stack or credential.
  if (error instanceof AppError) {
    return {
      code: error.code ?? ERROR_CODES.UNKNOWN_ERROR,
      message: error.message,
      status: error.status
    };
  }
  return { code: ERROR_CODES.INTERNAL_SERVER_ERROR, message: SAFE_GENERIC_MESSAGE, status: 500 };
}
