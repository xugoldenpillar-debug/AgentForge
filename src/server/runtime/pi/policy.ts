import { AppError, ERROR_CODES, ensure } from '../../../shared/errors.ts';
import { PI_ALLOWED_TOOLS } from '../../../shared/runtime-contract.ts';
import type { PiAgentOptionsLike, PiAgentToolLike } from './package.ts';

export const PI_DENIED_CODING_AGENT_TOOLS = [
  'bash',
  'read',
  'edit',
  'write',
  'powershell',
  'grep',
  'find',
  'ls'
] as const;

const ALLOWED = new Set<string>(PI_ALLOWED_TOOLS);
const DENIED_CODING_AGENT = new Set<string>(PI_DENIED_CODING_AGENT_TOOLS);
const POLICY_MESSAGE = 'This runtime policy allows only the calculator tool.';

function policyDenied(message = POLICY_MESSAGE): never {
  throw new AppError(message, 400, ERROR_CODES.RUNTIME_POLICY_DENIED);
}

export function normalizeToolName(name: unknown): string {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

export function isAllowedPiToolName(name: unknown): name is (typeof PI_ALLOWED_TOOLS)[number] {
  return ALLOWED.has(normalizeToolName(name));
}

export function assertToolAllowed(name: unknown): asserts name is (typeof PI_ALLOWED_TOOLS)[number] {
  const normalized = normalizeToolName(name);
  if (DENIED_CODING_AGENT.has(normalized) || !ALLOWED.has(normalized)) {
    policyDenied();
  }
}

export function denyUnknownTool(name: unknown): never {
  assertToolAllowed(name);
  policyDenied();
}

export function assertOnlyAllowlistedTools(tools: readonly PiAgentToolLike[]): void {
  ensure(tools.length <= PI_ALLOWED_TOOLS.length, POLICY_MESSAGE, 400, ERROR_CODES.RUNTIME_POLICY_DENIED);
  for (const tool of tools) {
    assertToolAllowed(tool.name);
  }
}

export function assertNoDefaultCodingAgentTools(tools: readonly PiAgentToolLike[]): void {
  for (const tool of tools) {
    if (DENIED_CODING_AGENT.has(normalizeToolName(tool.name))) policyDenied();
  }
}

export function assertIsolatedPiOptions(options: PiAgentOptionsLike): void {
  if (
    options.resourceLoader != null
    || options.cwd != null
    || options.sessionDir != null
    || options.agentsFilesOverride != null
    || options.getApiKey != null
  ) {
    policyDenied('This run is not allowed by the current runtime policy.');
  }
  ensure(
    options.shouldStopAfterTurn === undefined,
    'This run is not allowed by the current runtime policy.',
    400,
    ERROR_CODES.RUNTIME_POLICY_DENIED
  );
  const tools = options.initialState?.tools ?? [];
  assertOnlyAllowlistedTools(tools);
  assertNoDefaultCodingAgentTools(tools);
}
