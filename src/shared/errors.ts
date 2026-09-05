export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.name='AppError'; this.status=status; }
}
export function ensure(condition: unknown, message: string, status=400): asserts condition { if (!condition) throw new AppError(message,status); }
export function safeError(error: unknown): {message:string;status:number} {
  // Never serialize a provider exception, request, response, stack or credential.
  return error instanceof AppError ? {message:error.message,status:error.status} : {message:'The request could not be completed. Check your configuration and try again.',status:500};
}
