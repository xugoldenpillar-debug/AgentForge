import type { Constraints } from '../../shared/types.ts';
import { AppError, ERROR_CODES, ensure } from '../../shared/errors.ts';
import { calculateCost, type Pricing } from '../scoring/index.ts';

export interface SerialRuntimeBudgetSnapshot {
  remainingTokens: number;
  remainingToolCalls: number;
  remainingCost: number;
  usedInputTokens: number;
  usedOutputTokens: number;
  usedToolCalls: number;
  usedCost: number | null;
  modelSteps: number;
}

export interface SerialRuntimeBudget {
  snapshot(): SerialRuntimeBudgetSnapshot;
  remainingTokens(): number;
  remainingToolCalls(): number;
  remainingCost(): number;
  assertLatency(): void;
  assertCanStartModelStep(maxSteps: number): void;
  beginModelStep(): void;
  consumeUsage(inputTokens: number, outputTokens: number): void;
  rejectMissingUsage(): never;
  reserveToolCall(toolCallId?: string): void;
}

/**
 * Token, tool, and cost checks run synchronously so a parallel tool batch
 * cannot pass two reservations before either side effect starts.
 */
export function createSerialRuntimeBudget(args: {
  constraints: Constraints;
  maxToolCalls: number;
  pricing: Pricing;
  now?: () => number;
}): SerialRuntimeBudget {
  const now = args.now ?? (() => Date.now());
  const startedAt = now();
  const reservedToolCallIds = new Set<string>();
  let remainingTokens = args.constraints.tokenBudget;
  let remainingToolCalls = Math.min(args.constraints.toolCallLimit, args.maxToolCalls);
  let remainingCost = args.constraints.maxCost;
  let usedInputTokens = 0;
  let usedOutputTokens = 0;
  let usedToolCalls = 0;
  let usedCost: number | null = 0;
  let modelSteps = 0;

  function snapshot(): SerialRuntimeBudgetSnapshot {
    return {
      remainingTokens,
      remainingToolCalls,
      remainingCost,
      usedInputTokens,
      usedOutputTokens,
      usedToolCalls,
      usedCost,
      modelSteps
    };
  }

  function assertLatency(): void {
    ensure(
      now() - startedAt <= args.constraints.maxLatencyMs,
      'Latency budget exceeded.',
      400,
      ERROR_CODES.BUDGET_EXCEEDED
    );
  }

  function assertFiniteNonNegativeInteger(value: number, message: string): void {
    ensure(
      Number.isSafeInteger(value) && value >= 0,
      message,
      502,
      ERROR_CODES.PROVIDER_RESPONSE_INVALID
    );
  }

  return {
    snapshot,
    remainingTokens: () => remainingTokens,
    remainingToolCalls: () => remainingToolCalls,
    remainingCost: () => remainingCost,
    assertLatency,
    assertCanStartModelStep(maxSteps: number): void {
      assertLatency();
      ensure(
        Number.isInteger(maxSteps) && maxSteps >= 0 && modelSteps < maxSteps,
        'Model-call budget exceeded.',
        400,
        ERROR_CODES.BUDGET_EXCEEDED
      );
      ensure(
        remainingTokens >= 1,
        'Energy budget exceeded before the next model call.',
        400,
        ERROR_CODES.BUDGET_EXCEEDED
      );
      const reservation = calculateCost(1, 1, args.pricing);
      ensure(
        reservation === null || reservation <= remainingCost,
        'Cost budget exceeded before the next model call.',
        400,
        ERROR_CODES.BUDGET_EXCEEDED
      );
    },
    beginModelStep(): void {
      modelSteps += 1;
    },
    consumeUsage(inputTokens: number, outputTokens: number): void {
      assertFiniteNonNegativeInteger(inputTokens, 'Provider returned invalid usage metrics.');
      assertFiniteNonNegativeInteger(outputTokens, 'Provider returned invalid usage metrics.');
      const total = inputTokens + outputTokens;
      ensure(
        total <= remainingTokens,
        'Energy budget exceeded.',
        400,
        ERROR_CODES.BUDGET_EXCEEDED
      );
      const cost = calculateCost(inputTokens, outputTokens, args.pricing);
      if (cost === null) {
        usedCost = null;
      } else {
        ensure(
          cost <= remainingCost,
          'Cost budget exceeded.',
          400,
          ERROR_CODES.BUDGET_EXCEEDED
        );
        remainingCost -= cost;
        usedCost = (usedCost ?? 0) + cost;
      }
      remainingTokens -= total;
      usedInputTokens += inputTokens;
      usedOutputTokens += outputTokens;
    },
    rejectMissingUsage(): never {
      throw new AppError(
        'Provider returned invalid usage metrics.',
        502,
        ERROR_CODES.PROVIDER_RESPONSE_INVALID
      );
    },
    reserveToolCall(toolCallId?: string): void {
      if (toolCallId !== undefined && reservedToolCallIds.has(toolCallId)) return;
      ensure(
        remainingToolCalls >= 1,
        'Tool-call budget exceeded.',
        400,
        ERROR_CODES.BUDGET_EXCEEDED
      );
      remainingToolCalls -= 1;
      usedToolCalls += 1;
      if (toolCallId !== undefined) reservedToolCallIds.add(toolCallId);
    }
  };
}
