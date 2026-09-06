export const EVALUATION_ERROR_CODES = {
  INVALID_CONTRACT: 'INVALID_CONTRACT',
  INVALID_ASSOCIATION: 'INVALID_ASSOCIATION',
  PURPOSE_ASSOCIATION_MISMATCH: 'PURPOSE_ASSOCIATION_MISMATCH',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  TERMINAL_STATE_IMMUTABLE: 'TERMINAL_STATE_IMMUTABLE'
} as const;

export type EvaluationErrorCode = typeof EVALUATION_ERROR_CODES[keyof typeof EVALUATION_ERROR_CODES];

export interface EvaluationErrorDetails {
  readonly entity?: string;
  readonly from?: string;
  readonly to?: string;
  readonly purpose?: string;
  readonly association?: string;
}

export class EvaluationContractError extends Error {
  readonly code: EvaluationErrorCode;
  readonly details: EvaluationErrorDetails | undefined;

  constructor(code: EvaluationErrorCode, message: string, details?: EvaluationErrorDetails) {
    super(message);
    this.name = 'EvaluationContractError';
    this.code = code;
    this.details = details;
  }
}

export function invalidContract(message: string, details?: EvaluationErrorDetails): EvaluationContractError {
  return new EvaluationContractError(EVALUATION_ERROR_CODES.INVALID_CONTRACT, message, details);
}
