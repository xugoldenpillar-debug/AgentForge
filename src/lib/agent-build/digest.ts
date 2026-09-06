import { createHash } from 'node:crypto';
import { parseAgentBuildDefinition } from '../../shared/agent-build-contract.ts';

/**
 * Server-native, domain-separated SHA-256 of the v1 normalized definition.
 * Fixed property ordering comes from the parser, never caller insertion order.
 * This is a definition identity, not an authorized Frozen Run snapshot: resolved
 * dependencies, grants, inputs and authoritative policies are frozen elsewhere.
 */
export function digestAgentBuildDefinition(input: unknown): string {
  const definition = parseAgentBuildDefinition(input);
  return `sha256:${createHash('sha256')
    .update('agentforge:agent-build:v1\n', 'utf8')
    .update(JSON.stringify(definition), 'utf8')
    .digest('hex')}`;
}
