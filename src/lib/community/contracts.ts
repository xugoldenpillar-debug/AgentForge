import { AppError, ERROR_CODES } from '../../shared/error-core.ts';
import type { ErrorCode } from '../../shared/error-core.ts';
import type { Workflow } from '../../shared/workflow-types.ts';
import { publicWorkflow, validateWorkflow } from '../../shared/workflow-validation.ts';

export type CommunityComponentKind = 'workflow-recipe' | 'instruction-skill';
export type CommunityExampleOutcome = 'success' | 'failure';
export type CommunityExampleVisibility = 'public' | 'private';
export type CommunitySourceType = 'original' | 'adapted' | 'third-party';

export interface CommunityDependency {
  type: string;
  platformId: string;
  version: string;
  digest: string;
}

export interface CommunityExample {
  id: string;
  label: string;
  input: string;
  output: string;
  outcome: CommunityExampleOutcome;
  visibility: CommunityExampleVisibility;
}

export interface CommunityAttachmentManifest {
  path: string;
  mediaType: 'text/plain';
  sizeBytes: number;
  sha256: string;
}

export interface CommunityProvenance {
  sourceType: CommunitySourceType;
  declaration: string;
}

export interface WorkflowRecipeDefinition {
  formatVersion: 1;
  kind: 'workflow-recipe';
  name: string;
  description: string;
  workflow: Workflow;
  dependencies: CommunityDependency[];
  examples: CommunityExample[];
  license: string | null;
  provenance: CommunityProvenance;
}

export interface InstructionSkillDefinition {
  formatVersion: 1;
  kind: 'instruction-skill';
  name: string;
  description: string;
  instruction: string;
  references: CommunityAttachmentManifest[];
  dependencies: CommunityDependency[];
  examples: CommunityExample[];
  license: string | null;
  provenance: CommunityProvenance;
}

export type CommunityComponentDefinition = WorkflowRecipeDefinition | InstructionSkillDefinition;

export interface PublicComponentProjectionSource {
  id: string;
  versionId: string;
  definition: CommunityComponentDefinition;
  status: 'active' | 'deprecated' | 'revoked';
  publicExampleIds: string[];
  publicReferencePaths?: string[];
}

export interface PublicWorkflowRecipeProjection {
  id: string;
  versionId: string;
  kind: 'workflow-recipe';
  name: string;
  description: string;
  workflow: Workflow;
  dependencies: CommunityDependency[];
  examples: CommunityExample[];
  license: string;
  provenance: CommunityProvenance;
  status?: 'active' | 'deprecated' | 'revoked';
}

export interface PublicInstructionSkillProjection {
  id: string;
  versionId: string;
  kind: 'instruction-skill';
  name: string;
  description: string;
  instruction: string;
  references: CommunityAttachmentManifest[];
  dependencies: CommunityDependency[];
  examples: CommunityExample[];
  license: string;
  provenance: CommunityProvenance;
  status?: 'active' | 'deprecated' | 'revoked';
}

export type PublicComponentProjection = PublicWorkflowRecipeProjection | PublicInstructionSkillProjection;

export const COMMUNITY_LICENSE_ALLOWLIST = Object.freeze([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC'
] as const);

type RecordValue = Record<string, unknown>;

const MAX_NAME_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 4_000;
const MAX_INSTRUCTION_LENGTH = 64_000;
// Defensive contract-parser bounds only; these are not self-test quota or pricing policy.
const MAX_EXAMPLES = 20;
const MAX_DEPENDENCIES = 32;
const MAX_REFERENCES = 20;
const MAX_REFERENCE_BYTES = 256 * 1024;
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]{1,120}$/;
const SHA256 = /^(?:sha256:)?[a-f0-9]{64}$/i;
const EXECUTABLE_OR_SECRET_EXTENSION = /\.(?:ba?t|cmd|com|dll|env|exe|js|mjs|pem|p12|py|rb|sh|so|sql|ts|tsx|wasm)$/i;
const REMOTE_REFERENCE = /(?:https?|ftp|file|javascript):\/\//i;
const DATA_REFERENCE = /^\s*data:/i;
const FORBIDDEN_KEYS = new Set([
  'apiKey',
  'api_key',
  'apikey',
  'cookie',
  'credentials',
  'credential',
  'password',
  'secret',
  'token',
  'score',
  'scores',
  'platformVerified',
  'platform_verified',
  'hidden',
  'fixtures',
  'fixture',
  'script',
  'scripts',
  'command',
  'commands',
  'shell',
  'executable',
  'isExecutable',
  'symlink',
  'isSymlink',
  'remoteUrl',
  'remoteURL',
  'url',
  'fetch',
  'install',
  'entrypoint',
  'entryPoint',
  'mcp'
]);

function isRecord(value: unknown): value is RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(code: ErrorCode, message: string, status = 400): never {
  throw new AppError(message, status, code);
}

function invalidDefinition(): never {
  return fail(ERROR_CODES.COMPONENT_DEFINITION_INVALID, 'Component definition is invalid.');
}

function unsupportedCapability(): never {
  return fail(ERROR_CODES.COMPONENT_UNSUPPORTED_CAPABILITY, 'Component definition uses an unsupported capability.');
}

function invalidAttachment(): never {
  return fail(ERROR_CODES.COMPONENT_ATTACHMENT_INVALID, 'Component attachment manifest is invalid.');
}

function assertRecord(value: unknown, error: () => never = invalidDefinition): asserts value is RecordValue {
  if (!isRecord(value)) error();
}

function assertExactKeys(value: RecordValue, allowed: readonly string[], error: () => never = invalidDefinition): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) error();
}

function assertString(value: unknown, maxLength: number, error: () => never = invalidDefinition, required = true): string {
  if (typeof value !== 'string' || value.length > maxLength || (required && value.length === 0)) error();
  return value;
}

function assertNoRemoteReference(value: string, error: () => never = unsupportedCapability): void {
  if (REMOTE_REFERENCE.test(value) || DATA_REFERENCE.test(value)) error();
}

function inspectForbiddenKeys(
  value: unknown,
  seen = new Set<object>(),
  context: 'component' | 'reference' | 'workflow' = 'component'
): void {
  if (Array.isArray(value)) {
    for (const item of value) inspectForbiddenKeys(item, seen, context);
    return;
  }
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    const nestedContext = context === 'reference' || key === 'references'
      ? 'reference'
      : key === 'workflow'
        ? 'workflow'
        : context === 'workflow'
          ? 'workflow'
          : 'component';
    if ((key === 'credentialId' && context !== 'workflow') || FORBIDDEN_KEYS.has(key)) {
      if (context === 'reference') invalidAttachment();
      unsupportedCapability();
    }
    inspectForbiddenKeys(nested, seen, nestedContext);
  }
}

function assertDenseArray(value: unknown, maxLength: number, error: () => never): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > maxLength) error();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) error();
  }
}

function validateDependencies(value: unknown): CommunityDependency[] {
  assertDenseArray(value, MAX_DEPENDENCIES, invalidDefinition);
  return value.map((entry) => {
    assertRecord(entry);
    assertExactKeys(entry, ['type', 'platformId', 'version', 'digest']);
    const type = assertString(entry.type, 80);
    const platformId = assertString(entry.platformId, 160);
    const version = assertString(entry.version, 160);
    const digest = assertString(entry.digest, 100);
    assertNoRemoteReference(type);
    assertNoRemoteReference(platformId);
    assertNoRemoteReference(version);
    assertNoRemoteReference(digest);
    if (!/^(?:sha256:)?[a-f0-9]{64}$/i.test(digest)) invalidDefinition();
    return { type, platformId, version, digest };
  });
}

function validateExamples(value: unknown): CommunityExample[] {
  assertDenseArray(value, MAX_EXAMPLES, invalidDefinition);
  const ids = new Set<string>();
  return value.map((entry) => {
    assertRecord(entry);
    assertExactKeys(entry, ['id', 'label', 'input', 'output', 'outcome', 'visibility']);
    const id = assertString(entry.id, 120);
    const label = assertString(entry.label, 160);
    const input = assertString(entry.input, 16_000, invalidDefinition, false);
    const output = assertString(entry.output, 16_000, invalidDefinition, false);
    const outcome = entry.outcome;
    const visibility = entry.visibility;
    if (outcome !== 'success' && outcome !== 'failure') invalidDefinition();
    if (visibility !== 'public' && visibility !== 'private') invalidDefinition();
    if (ids.has(id)) invalidDefinition();
    ids.add(id);
    assertNoRemoteReference(label);
    assertNoRemoteReference(input);
    assertNoRemoteReference(output);
    return { id, label, input, output, outcome, visibility };
  });
}

function validateLicense(value: unknown): string | null {
  if (value === null) return null;
  const license = assertString(value, 120);
  assertNoRemoteReference(license);
  return license;
}

function validateProvenance(value: unknown): CommunityProvenance {
  assertRecord(value);
  assertExactKeys(value, ['sourceType', 'declaration']);
  const sourceType = value.sourceType;
  const declaration = assertString(value.declaration, 4_000);
  if (sourceType !== 'original' && sourceType !== 'adapted' && sourceType !== 'third-party') invalidDefinition();
  assertNoRemoteReference(declaration);
  return { sourceType, declaration };
}

function validateWorkflowShape(value: unknown): Workflow {
  assertRecord(value);
  assertExactKeys(value, ['nodes', 'edges']);
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) invalidDefinition();
  for (const node of value.nodes) {
    assertRecord(node);
    assertExactKeys(node, ['id', 'kind', 'label', 'x', 'y', 'config']);
    assertRecord(node.config);
  }
  for (const edge of value.edges) {
    assertRecord(edge);
    assertExactKeys(edge, ['id', 'source', 'target']);
  }

  let workflow: Workflow;
  try {
    workflow = validateWorkflow(value);
  } catch (error) {
    if (error instanceof AppError) invalidDefinition();
    throw error;
  }

  // The existing DAG contract uses an empty credentialId as its unresolved-provider placeholder.
  // Community definitions may retain that placeholder for compatibility, but never a real reference.
  for (const node of workflow.nodes) {
    if (node.kind === 'model' && node.config.credentialId !== '') unsupportedCapability();
  }
  return workflow;
}

function validateReferencePath(value: unknown): string {
  const path = assertString(value, 240, invalidAttachment);
  if (
    path.startsWith('/') ||
    path.endsWith('/') ||
    path.includes('\\') ||
    path.includes('\u0000') ||
    path.includes('//') ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
    !path.startsWith('references/') ||
    EXECUTABLE_OR_SECRET_EXTENSION.test(path)
  ) {
    invalidAttachment();
  }
  return path;
}

function validateReferences(value: unknown): CommunityAttachmentManifest[] {
  assertDenseArray(value, MAX_REFERENCES, invalidAttachment);
  const paths = new Set<string>();
  return value.map((entry) => {
    assertRecord(entry, invalidAttachment);
    assertExactKeys(entry, ['path', 'mediaType', 'sizeBytes', 'sha256'], invalidAttachment);
    const path = validateReferencePath(entry.path);
    if (entry.mediaType !== 'text/plain') invalidAttachment();
    if (!Number.isSafeInteger(entry.sizeBytes) || Number(entry.sizeBytes) < 0 || Number(entry.sizeBytes) > MAX_REFERENCE_BYTES) invalidAttachment();
    const sha256 = assertString(entry.sha256, 80, invalidAttachment);
    if (!SHA256.test(sha256)) invalidAttachment();
    if (paths.has(path)) invalidAttachment();
    paths.add(path);
    return { path, mediaType: 'text/plain', sizeBytes: Number(entry.sizeBytes), sha256 };
  });
}

export function parseWorkflowRecipe(value: unknown): WorkflowRecipeDefinition {
  inspectForbiddenKeys(value);
  assertRecord(value);
  assertExactKeys(value, ['formatVersion', 'kind', 'name', 'description', 'workflow', 'dependencies', 'examples', 'license', 'provenance']);
  if (value.formatVersion !== 1 || value.kind !== 'workflow-recipe') invalidDefinition();
  const name = assertString(value.name, MAX_NAME_LENGTH);
  const description = assertString(value.description, MAX_DESCRIPTION_LENGTH);
  assertNoRemoteReference(name);
  assertNoRemoteReference(description);
  const workflow = validateWorkflowShape(value.workflow);
  const dependencies = validateDependencies(value.dependencies);
  const examples = validateExamples(value.examples);
  const license = validateLicense(value.license);
  const provenance = validateProvenance(value.provenance);
  return { formatVersion: 1, kind: 'workflow-recipe', name, description, workflow, dependencies, examples, license, provenance };
}

export function parseInstructionSkill(value: unknown): InstructionSkillDefinition {
  inspectForbiddenKeys(value);
  assertRecord(value);
  assertExactKeys(value, ['formatVersion', 'kind', 'name', 'description', 'instruction', 'references', 'dependencies', 'examples', 'license', 'provenance']);
  if (value.formatVersion !== 1 || value.kind !== 'instruction-skill') invalidDefinition();
  const name = assertString(value.name, MAX_NAME_LENGTH);
  const description = assertString(value.description, MAX_DESCRIPTION_LENGTH);
  const instruction = assertString(value.instruction, MAX_INSTRUCTION_LENGTH);
  assertNoRemoteReference(name);
  assertNoRemoteReference(description);
  assertNoRemoteReference(instruction);
  const references = validateReferences(value.references);
  const dependencies = validateDependencies(value.dependencies);
  const examples = validateExamples(value.examples);
  const license = validateLicense(value.license);
  const provenance = validateProvenance(value.provenance);
  return { formatVersion: 1, kind: 'instruction-skill', name, description, instruction, references, dependencies, examples, license, provenance };
}

export function parseCommunityDefinition(value: unknown): CommunityComponentDefinition {
  if (!isRecord(value)) invalidDefinition();
  if (value.kind === 'workflow-recipe') return parseWorkflowRecipe(value);
  if (value.kind === 'instruction-skill') return parseInstructionSkill(value);
  invalidDefinition();
}

export function parseCommunityDefinitionJson(value: string): CommunityComponentDefinition {
  if (typeof value !== 'string') invalidDefinition();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    invalidDefinition();
  }
  return parseCommunityDefinition(parsed);
}

function validatePublicIdentity(value: unknown): string {
  const id = assertString(value, 120);
  if (!SAFE_IDENTIFIER.test(id)) invalidDefinition();
  return id;
}

function projectExamples(definition: CommunityComponentDefinition, selectedIds: string[] | undefined): CommunityExample[] {
  // Publication must carry an explicit allowlist; omission is fail closed.
  if (!Array.isArray(selectedIds) || selectedIds.some((id) => typeof id !== 'string')) invalidDefinition();
  const selected = new Set(selectedIds);
  if (selected.size !== selectedIds.length) invalidDefinition();
  const examples = definition.examples.filter((example) => selected.has(example.id) && example.visibility === 'public');
  if (examples.length !== selected.size) invalidDefinition();
  return structuredClone(examples);
}

function projectReferences(
  definition: InstructionSkillDefinition,
  selectedPaths: string[] | undefined
): CommunityAttachmentManifest[] {
  // Publication must carry an explicit allowlist; omission is fail closed.
  if (!Array.isArray(selectedPaths) || selectedPaths.some((path) => typeof path !== 'string')) invalidAttachment();
  const selected = new Set(selectedPaths);
  if (selected.size !== selectedPaths.length) invalidAttachment();
  const references = definition.references.filter((reference) => selected.has(reference.path));
  if (references.length !== selected.size) invalidAttachment();
  return structuredClone(references);
}

function projectStatus(status: PublicComponentProjectionSource['status']): 'active' | 'deprecated' | 'revoked' | undefined {
  if (status === 'active' || status === 'deprecated' || status === 'revoked') return status;
  return undefined;
}

export function projectPublicComponent(source: PublicComponentProjectionSource): PublicComponentProjection {
  const id = validatePublicIdentity(source.id);
  const versionId = validatePublicIdentity(source.versionId);
  // Re-parse at the projection boundary so callers cannot smuggle mutable or sensitive fields
  // through a structurally cast definition.
  const definition = parseCommunityDefinition(source.definition);
  const license = definition.license;
  if (!license) fail(ERROR_CODES.COMPONENT_LICENSE_REQUIRED, 'A license is required for public projection.');
  if (!(COMMUNITY_LICENSE_ALLOWLIST as readonly string[]).includes(license)) {
    fail(ERROR_CODES.COMPONENT_LICENSE_UNSUPPORTED, 'This license is not allowed for public projection.');
  }
  const status = projectStatus(source.status);
  if (!status) invalidDefinition();
  const examples = projectExamples(definition, source.publicExampleIds);

  if (definition.kind === 'workflow-recipe') {
    const projection: PublicWorkflowRecipeProjection = {
      id,
      versionId,
      kind: 'workflow-recipe',
      name: definition.name,
      description: definition.description,
      workflow: publicWorkflow(definition.workflow, true),
      dependencies: structuredClone(definition.dependencies),
      examples,
      license,
      provenance: structuredClone(definition.provenance)
    };
    if (status) projection.status = status;
    return projection;
  }

  const projection: PublicInstructionSkillProjection = {
    id,
    versionId,
    kind: 'instruction-skill',
    name: definition.name,
    description: definition.description,
    instruction: definition.instruction,
    references: projectReferences(definition, source.publicReferencePaths),
    dependencies: structuredClone(definition.dependencies),
    examples,
    license,
    provenance: structuredClone(definition.provenance)
  };
  if (status) projection.status = status;
  return projection;
}
