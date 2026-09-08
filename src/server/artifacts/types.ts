import type { SandboxSnapshot, SandboxSnapshotEntry, SandboxSnapshotFile } from '../sandbox/types.ts';
import { ARTIFACT_COLLECTION_MANIFEST_VERSION, type ArtifactCollectionClassification, type ArtifactCollectionManifestEntryV1, type ArtifactCollectionManifestV1 } from '../../shared/artifact-contract.ts';

export const ARTIFACT_CLASSIFICATIONS = ['public-feedback', 'private-creation', 'hidden'] as const;
export type ArtifactClassification = ArtifactCollectionClassification;

export const ARTIFACT_MANIFEST_VERSION = ARTIFACT_COLLECTION_MANIFEST_VERSION;
export type ArtifactCollectionManifestEntry = ArtifactCollectionManifestEntryV1;
export type ArtifactCollectionManifest = ArtifactCollectionManifestV1;

export interface ArtifactOutputSlot {
  readonly slotId: string;
  readonly relativePath: string;
  readonly mediaTypes: readonly string[];
  readonly classification: ArtifactClassification;
  readonly required: boolean;
  readonly maxBytes: number;
}

export interface ArtifactCollectionLimits {
  readonly maxEntries: number;
  readonly maxFileBytes: number;
  readonly maxOutputBytes: number;
}

export const DEFAULT_ARTIFACT_COLLECTION_LIMITS: ArtifactCollectionLimits = Object.freeze({
  maxEntries: 64,
  maxFileBytes: 4 * 1024 * 1024,
  maxOutputBytes: 16 * 1024 * 1024
});

export interface ArtifactCollectionContext {
  readonly businessRef: string;
  readonly attemptId: string;
  readonly fenceToken: string;
  readonly environmentDigest: string;
  readonly outputContractVersion: string;
  readonly limits?: ArtifactCollectionLimits;
}

export interface ArtifactSnapshotReader {
  readonly snapshot: SandboxSnapshot;
  readFile(relativePath: string, limit: number): Promise<SandboxSnapshotFile>;
}

/** @deprecated Use ArtifactCollectionManifestEntry for runtime collection data. */
export type ArtifactManifestEntry = ArtifactCollectionManifestEntry;
/** @deprecated Use ArtifactCollectionManifest for runtime collection data. */
export type ArtifactManifest = ArtifactCollectionManifest;

export interface ArtifactCollectionResult {
  readonly manifest: ArtifactCollectionManifest;
  readonly files: readonly SandboxSnapshotFile[];
}

export type PreviewFormat = 'html' | 'css' | 'markdown' | 'svg' | 'json' | 'csv' | 'text' | 'image';
export type PreviewRenderer =
  | 'html-sandbox'
  | 'css-text'
  | 'markdown-sanitized'
  | 'svg-animation-sandbox'
  | 'json-tree'
  | 'csv-table'
  | 'plain-text'
  | 'image';

export interface PreviewProjection {
  readonly artifactId: string;
  readonly relativePath: string;
  readonly mediaType: string;
  readonly format: PreviewFormat;
  readonly renderer: PreviewRenderer;
  readonly maxBytes: number;
  readonly allowScripts: false;
  readonly allowRemoteResources: false;
  readonly allowNavigation: false;
  readonly allowForms: false;
  readonly allowPopups: false;
  readonly rawHtmlAllowed: false;
  readonly formulaExecution: false;
}

export type ArtifactEntryInput = SandboxSnapshotEntry;

export type PreviewContentBody =
  | { readonly kind: 'text'; readonly content: string }
  | { readonly kind: 'binary'; readonly base64: string };

export interface PreviewContentProjection {
  readonly plan: PreviewProjection;
  readonly body: PreviewContentBody;
}
