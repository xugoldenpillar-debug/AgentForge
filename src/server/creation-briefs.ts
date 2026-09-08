import { ensure, ERROR_CODES } from '../shared/errors.ts';
import {
  digestCreationBriefVersion,
  digestCreationBuildContext,
  parseCreationBriefVersion,
  parseCreationBuildContext,
  type CreationBriefVersionV1,
  type CreationBuildContextV1,
} from '../shared/artifact-contract.ts';
import type { CreationBrief, CreationBriefVersionRow, CreationRun } from '../shared/types.ts';

const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;

function recordId(value: string, label: string): string {
  ensure(RECORD_ID.test(value), `Invalid ${label}.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return value;
}

export function normalizeCreationBriefVersion(input: unknown): CreationBriefVersionV1 {
  return parseCreationBriefVersion(input);
}

export function toCreationBriefRecord(
  briefId: string,
  ownerId: string,
  createdAt: string,
  updatedAt = createdAt,
): CreationBrief {
  return Object.freeze({
    id: recordId(briefId, 'creation brief id'),
    ownerId: recordId(ownerId, 'creation brief owner'),
    createdAt,
    updatedAt,
  });
}

export function toCreationBriefVersionRow(
  input: unknown,
  ownerId: string,
  createdAt: string,
): CreationBriefVersionRow {
  const version = normalizeCreationBriefVersion(input);
  return Object.freeze({
    id: version.versionId,
    briefId: version.briefId,
    ownerId: recordId(ownerId, 'creation brief owner'),
    versionNumber: version.versionNumber,
    title: version.title,
    instructions: version.instructions,
    inputAttachments: version.inputAttachments,
    outputPolicy: version.outputPolicy,
    contentDigest: digestCreationBriefVersion(version),
    createdAt,
  });
}

export interface CreationRunRecordInput {
  readonly id: string;
  readonly ownerId: string;
  readonly buildId: string;
  readonly buildVersionId: string;
  readonly briefId: string;
  readonly briefVersionId: string;
  readonly challengeVersionId?: string | null;
  readonly environmentTemplateId: string;
  readonly environmentTemplateVersionId: string;
  readonly evaluationJobId?: string | null;
  readonly artifactBundleId?: string | null;
  readonly status?: CreationRun['status'];
  readonly context: unknown;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
}

/** Build a CreationRun row while checking that denormalized refs match the signed context. */
export function toCreationRunRow(input: CreationRunRecordInput): CreationRun {
  const context: CreationBuildContextV1 = parseCreationBuildContext(input.context);
  ensure(context.buildRef.buildId === input.buildId && context.buildRef.versionId === input.buildVersionId,
    'Creation run build reference does not match its context.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(context.briefVersionRef.briefId === input.briefId && context.briefVersionRef.versionId === input.briefVersionId,
    'Creation run brief reference does not match its context.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(context.environmentVersionRef.templateId === input.environmentTemplateId &&
    context.environmentVersionRef.versionId === input.environmentTemplateVersionId,
  'Creation run environment reference does not match its context.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return Object.freeze({
    id: recordId(input.id, 'creation run id'),
    ownerId: recordId(input.ownerId, 'creation run owner'),
    buildId: recordId(input.buildId, 'creation run build id'),
    buildVersionId: recordId(input.buildVersionId, 'creation run build version id'),
    briefId: recordId(input.briefId, 'creation run brief id'),
    briefVersionId: recordId(input.briefVersionId, 'creation run brief version id'),
    challengeVersionId: input.challengeVersionId === undefined || input.challengeVersionId === null
      ? null
      : recordId(input.challengeVersionId, 'creation challenge version id'),
    environmentTemplateId: recordId(input.environmentTemplateId, 'creation run environment template id'),
    environmentTemplateVersionId: recordId(input.environmentTemplateVersionId, 'creation run environment template version id'),
    evaluationJobId: input.evaluationJobId === undefined || input.evaluationJobId === null
      ? null
      : recordId(input.evaluationJobId, 'creation run evaluation job id'),
    artifactBundleId: input.artifactBundleId === undefined || input.artifactBundleId === null
      ? null
      : recordId(input.artifactBundleId, 'creation run artifact bundle id'),
    status: input.status ?? 'queued',
    context,
    contextDigest: digestCreationBuildContext(context),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
  });
}
