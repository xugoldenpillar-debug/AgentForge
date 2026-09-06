import { AppError, ERROR_CODES } from './error-core.ts';
import type { ErrorCode } from './error-core.ts';

export { AppError, ERROR_CODES, ensure, withErrorCode } from './error-core.ts';
export type { ErrorCode } from './error-core.ts';

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
