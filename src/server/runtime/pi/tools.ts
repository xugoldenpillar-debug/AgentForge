import { AppError, ERROR_CODES, ensure } from '../../../shared/errors.ts';
import { executeSafeTool } from '../../../lib/ai/tools-core.ts';
import type { SerialRuntimeBudget } from '../../../lib/runtime/budget.ts';
import type { PiAgentToolLike, PiAgentToolResult } from './package.ts';
import { assertToolAllowed, denyUnknownTool } from './policy.ts';

export const CALCULATOR_TOOL_PARAMETERS = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    expression: Object.freeze({ type: 'string' })
  }),
  required: Object.freeze(['expression']),
  additionalProperties: false
});

function readExpression(params: unknown): string {
  if (typeof params === 'string') {
    ensure(params.trim().length > 0, 'Calculator requires an expression string.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    return params;
  }
  if (params !== null && typeof params === 'object' && !Array.isArray(params) && 'expression' in params) {
    const expression = (params as { expression: unknown }).expression;
    ensure(
      typeof expression === 'string' && expression.trim().length > 0,
      'Calculator requires an expression string.',
      400,
      ERROR_CODES.REQUEST_VALIDATION_FAILED
    );
    return expression;
  }
  throw new AppError('Calculator requires an expression string.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
}

export function dispatchPiTool(
  name: string,
  budget: SerialRuntimeBudget,
  toolCallId: string,
  params: unknown,
  signal?: AbortSignal
): Promise<PiAgentToolResult> {
  assertToolAllowed(name);
  if (name !== 'calculator') denyUnknownTool(name);
  return executeCalculator(budget, toolCallId, params, signal);
}

async function executeCalculator(
  budget: SerialRuntimeBudget,
  toolCallId: string,
  params: unknown,
  signal?: AbortSignal
): Promise<PiAgentToolResult> {
  budget.reserveToolCall(toolCallId);
  if (signal?.aborted) {
    throw new AppError('Run cancelled.', 499, ERROR_CODES.RUN_CANCELLED);
  }
  const expression = readExpression(params);
  const result = executeSafeTool('calculator', expression);
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }]
  };
}

export function createCalculatorTool(budget: SerialRuntimeBudget): PiAgentToolLike {
  return {
    name: 'calculator',
    label: 'Calculator',
    description: 'Evaluate bounded arithmetic. No code execution.',
    parameters: CALCULATOR_TOOL_PARAMETERS,
    executionMode: 'sequential',
    execute: async (toolCallId, params, signal) => {
      return dispatchPiTool('calculator', budget, toolCallId, params, signal);
    }
  };
}
