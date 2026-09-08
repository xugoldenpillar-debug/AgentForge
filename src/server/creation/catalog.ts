import { createHash } from 'node:crypto';
import {
  digestEnvironmentTemplateVersion,
  type EnvironmentTemplateVersionV1,
} from '../../shared/environment-contract.ts';

function digest(label: string): string {
  return `sha256:${createHash('sha256').update(label).digest('hex')}`;
}

export const CREATION_ENVIRONMENT_TEMPLATE = Object.freeze({
  schemaVersion: 1,
  templateId: 'artifact-animation-sandbox',
  versionId: 'artifact-animation-sandbox-v1',
  versionNumber: 1,
  name: 'Artifact animation sandbox',
  description: 'Pi runtime with a network-denied, output-only gVisor workspace for SVG animation artifacts.',
  runtime: {
    kind: 'pi',
    adapterVersion: 'pi-creation-v1',
    policyVersion: 'artifact-animation-v1',
  },
  capabilities: Object.freeze([
    Object.freeze({ kind: 'system' as const, capabilityId: 'workspace.read' as const, versionId: 'artifact-read-v1', contentDigest: digest('artifact.read:v1') }),
    Object.freeze({ kind: 'system' as const, capabilityId: 'artifact.write' as const, versionId: 'artifact-write-v1', contentDigest: digest('artifact.write:v1') }),
    Object.freeze({ kind: 'system' as const, capabilityId: 'preview.static' as const, versionId: 'svg-animation-v1', contentDigest: digest('svg-animation-v1') }),
    Object.freeze({ kind: 'system' as const, capabilityId: 'network.none' as const, versionId: 'network-none-v1', contentDigest: digest('network.none:v1') }),
  ]),
  limits: Object.freeze({
    maxExecutionMs: 120_000,
    maxMemoryMiB: 256,
    maxDiskBytes: 16 * 1024 * 1024,
    maxProcesses: 32,
  }),
  artifactPolicy: Object.freeze({
    allowedMediaTypes: Object.freeze(['text/html', 'image/svg+xml', 'text/css', 'text/markdown', 'text/plain'] as const),
    maxArtifacts: 16,
    maxArtifactBytes: 4 * 1024 * 1024,
    maxTotalBytes: 16 * 1024 * 1024,
  }),
} satisfies EnvironmentTemplateVersionV1);

export const CREATION_ENVIRONMENT_DIGEST = digestEnvironmentTemplateVersion(CREATION_ENVIRONMENT_TEMPLATE);


export const CREATION_BYOK_MODEL_REF = Object.freeze({
  id: 'animation-byok-model',
  versionId: 'animation-byok-model-v1',
  contentDigest: digest('animation-byok-model:v1'),
});

export const CREATION_OUTPUT_CONTRACT_REF = Object.freeze({
  id: 'svg-animation-output',
  versionId: 'svg-animation-output-v1',
  contentDigest: digest('svg-animation-output:v1'),
});

export const CREATION_AGENT_BUILD_CONTRACT = Object.freeze({
  modelSelection: CREATION_BYOK_MODEL_REF,
  outputContractRef: CREATION_OUTPUT_CONTRACT_REF,
  environmentRef: Object.freeze({
    id: CREATION_ENVIRONMENT_TEMPLATE.templateId,
    versionId: CREATION_ENVIRONMENT_TEMPLATE.versionId,
    contentDigest: CREATION_ENVIRONMENT_DIGEST,
  }),
  runtimeSelection: CREATION_ENVIRONMENT_TEMPLATE.runtime,
});
