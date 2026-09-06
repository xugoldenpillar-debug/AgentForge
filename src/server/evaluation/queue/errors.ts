export class EvaluationQueueUnavailableError extends Error {
  readonly code = 'EVALUATION_QUEUE_UNAVAILABLE' as const;

  constructor(message = 'The evaluation control plane is not ready.') {
    super(message);
    this.name = 'EvaluationQueueUnavailableError';
  }
}

export class EvaluationQueueProtocolError extends Error {
  readonly code = 'EVALUATION_QUEUE_PROTOCOL_ERROR' as const;

  constructor(message: string) {
    super(message);
    this.name = 'EvaluationQueueProtocolError';
  }
}
