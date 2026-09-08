import { createHash, randomUUID } from 'node:crypto';
import type { AIProvider, AIRequest, AIResult } from '../../../lib/ai/types.ts';
import { asOpaqueId } from '../../../shared/evaluation-types.ts';
import type { EvaluationRepository } from '../../../db/evaluation-repository.ts';
import type { EvaluationExecutionContext } from '../queue/ports.ts';

export class InvocationRecordingProvider implements AIProvider {
  readonly id: string;
  readonly pricing: AIProvider['pricing'];
  private readonly provider: AIProvider;
  private readonly repository: EvaluationRepository;
  private readonly context: EvaluationExecutionContext;
  private readonly nextIndex: () => number;
  private readonly now: () => string;
  private readonly assertAuthorized: () => Promise<void>;

  constructor(
    provider: AIProvider,
    repository: EvaluationRepository,
    context: EvaluationExecutionContext,
    nextIndex: () => number,
    now: () => string,
    assertAuthorized: () => Promise<void>,
  ) {
    this.id = provider.id;
    this.pricing = provider.pricing;
    this.provider = provider;
    this.repository = repository;
    this.context = context;
    this.nextIndex = nextIndex;
    this.now = now;
    this.assertAuthorized = assertAuthorized;
  }

  async execute(request: AIRequest): Promise<AIResult> {
    await this.assertAuthorized();
    const invocationIndex = this.nextIndex();
    const requestDigest = digestRequest(request);
    const requestId = `evaluation:${this.context.attempt.id}:${invocationIndex}`;
    const idempotencyKey = `${this.context.job.id}:${this.context.attempt.id}:${invocationIndex}:${requestDigest}`;
    const created = await this.repository.createInvocation({
      id: asOpaqueId<'evaluation-invocation'>(randomUUID()),
      jobId: this.context.job.id,
      attemptId: this.context.attempt.id,
      invocationIndex,
      requestId,
      idempotencyKey,
      providerScope: this.provider.id,
      providerId: this.provider.id,
      modelId: request.model,
      requestDigest,
    });
    if (!created.created && created.invocation.state !== 'pending') {
      throw new UnknownProviderResultError('INVOCATION_ALREADY_DISPATCHED');
    }
    const started = await this.repository.startInvocation({ invocationId: created.invocation.id, now: this.now() });
    if (!started) throw new UnknownProviderResultError('INVOCATION_LEASE_LOST');

    try {
      const result = await this.provider.execute(request);
      await this.repository.finalizeInvocation({
        invocationId: created.invocation.id,
        state: 'succeeded',
        providerRequestId: null,
        usage: usageRow(this.context, created.invocation.id, result, this.provider.id, this.now()),
        now: this.now(),
      });
      return result;
    } catch (error) {
      try {
        await this.repository.finalizeInvocation({
          invocationId: created.invocation.id,
          state: 'unknown',
          providerRequestId: null,
          usage: unknownUsageRow(this.context, created.invocation.id, this.provider.id, this.now()),
          now: this.now(),
        });
      } catch {
        // The provider call crossed the process boundary, so conservative unknown
        // accounting wins over a duplicate retry.
      }
      if (error instanceof UnknownProviderResultError) throw error;
      throw new UnknownProviderResultError('UPSTREAM_RESULT_UNKNOWN');
    }
  }
}

export class UnknownProviderResultError extends Error {
  readonly code: string;

  constructor(code = 'UPSTREAM_RESULT_UNKNOWN') {
    super('The provider result could not be confirmed.');
    this.name = 'UnknownProviderResultError';
    this.code = code;
  }
}

function digestRequest(request: AIRequest): string {
  return createHash('sha256').update(JSON.stringify({
    model: request.model,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    tools: request.tools,
    maxTokens: request.maxTokens,
    temperature: request.temperature,
  })).digest('hex');
}

function usageRow(
  context: EvaluationExecutionContext,
  invocationId: string,
  result: AIResult,
  providerId: string,
  recordedAt: string,
) {
  const estimated = result.estimated && providerId !== 'demo';
  return {
    id: randomUUID(),
    jobId: context.job.id,
    attemptId: context.attempt.id,
    invocationId,
    certainty: estimated ? 'unknown' as const : 'known' as const,
    chargeability: providerId === 'demo' ? 'not-chargeable' as const : result.cost === null ? 'uncertain' as const : 'chargeable' as const,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    reasoningTokens: result.reasoningTokens,
    toolCalls: result.toolCalls,
    latencyMs: result.latency,
    costUsd: result.cost,
    providerRequestId: null,
    evidenceRef: `evaluation:${context.attempt.id}`,
    recordedAt,
  };
}

function unknownUsageRow(
  context: EvaluationExecutionContext,
  invocationId: string,
  providerId: string,
  recordedAt: string,
) {
  return {
    id: randomUUID(),
    jobId: context.job.id,
    attemptId: context.attempt.id,
    invocationId,
    certainty: 'unknown' as const,
    chargeability: providerId === 'demo' ? 'not-chargeable' as const : 'uncertain' as const,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    toolCalls: null,
    latencyMs: null,
    costUsd: null,
    providerRequestId: null,
    evidenceRef: `evaluation:${context.attempt.id}`,
    recordedAt,
  };
}
