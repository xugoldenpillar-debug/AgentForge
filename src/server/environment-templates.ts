import { ensure, ERROR_CODES } from '../shared/errors.ts';
import {
  digestEnvironmentTemplateVersion,
  parseEnvironmentTemplateVersion,
  type EnvironmentTemplateOwnershipV1,
  type EnvironmentTemplateVersionV1,
} from '../shared/environment-contract.ts';
import type { EnvironmentTemplateVersionRow } from '../shared/types.ts';

const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;

function recordId(value: string, label: string): string {
  ensure(RECORD_ID.test(value), `Invalid ${label}.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return value;
}

/** Normalize a server-owned template version before it is inserted as an immutable row. */
export function normalizeEnvironmentTemplateVersion(
  input: unknown,
  ownership?: EnvironmentTemplateOwnershipV1,
): EnvironmentTemplateVersionV1 {
  const version = parseEnvironmentTemplateVersion(input);
  if (!ownership) return version;
  return parseEnvironmentTemplateVersion({
    ...version,
    scope: ownership.scope,
    ownerId: normalizeEnvironmentTemplateOwnerId(ownership.ownerId),
  });
}

export function toEnvironmentTemplateVersionRow(
  input: unknown,
  createdAt: string,
  ownership?: EnvironmentTemplateOwnershipV1,
): EnvironmentTemplateVersionRow {
  const version = normalizeEnvironmentTemplateVersion(input, ownership);
  const row: EnvironmentTemplateVersionRow = {
    id: version.versionId,
    templateId: version.templateId,
    versionNumber: version.versionNumber,
    name: version.name,
    description: version.description,
    runtimeKind: version.runtime.kind,
    runtimeAdapterVersion: version.runtime.adapterVersion,
    runtimePolicyVersion: version.runtime.policyVersion,
    capabilities: version.capabilities,
    limits: version.limits,
    artifactPolicy: version.artifactPolicy,
    contentDigest: digestEnvironmentTemplateVersion(version),
    createdAt,
  };
  return Object.freeze(row);
}

export function normalizeEnvironmentTemplateOwnerId(ownerId: string | null): string | null {
  return ownerId === null ? null : recordId(ownerId, 'environment template owner');
}
