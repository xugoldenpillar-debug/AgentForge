import { randomUUID } from 'node:crypto';
import { ensure, ERROR_CODES } from '../../shared/errors.ts';
import type { ExtensionApplication, Repository } from '../../shared/types.ts';
import { animationChallengeDigest } from '../animation-challenges.ts';

export interface ChallengeApplicationMaterial {
  readonly formatVersion: 1;
  readonly slug: string;
  readonly title: string;
  readonly titleEn: string;
  readonly instructions: string;
  readonly instructionsEn: string;
}

export interface ChallengeApplicationServiceOptions {
  readonly now?: () => string;
  readonly id?: () => string;
  readonly resolveRoles?: (actorId: string) => Promise<ReadonlySet<'reviewer' | 'admin'> | readonly ('reviewer' | 'admin')[]>;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function actor(value: string | null | undefined): string {
  ensure(typeof value === 'string' && value.trim().length > 0, 'Authentication is required.', 401, ERROR_CODES.AUTH_REQUIRED);
  return value;
}

function text(value: unknown, label: string, max: number): string {
  ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= max,
    `${label} is required.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return value.trim();
}

function material(value: unknown): ChallengeApplicationMaterial {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value),
    'Challenge material is invalid.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  const row = value as Record<string, unknown>;
  ensure(Object.keys(row).every((key) => ['formatVersion', 'slug', 'title', 'titleEn', 'instructions', 'instructionsEn'].includes(key)),
    'Challenge material contains unsupported fields.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(row.formatVersion === 1, 'Unsupported challenge material version.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  const slug = text(row.slug, 'slug', 80);
  ensure(SLUG.test(slug), 'Challenge slug must use lowercase letters, numbers and hyphens.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return Object.freeze({
    formatVersion: 1,
    slug,
    title: text(row.title, 'title', 120),
    titleEn: text(row.titleEn, 'titleEn', 120),
    instructions: text(row.instructions, 'instructions', 16_384),
    instructionsEn: text(row.instructionsEn, 'instructionsEn', 16_384),
  });
}

export class ChallengeApplicationService {
  readonly #repository: Repository;
  readonly #now: () => string;
  readonly #id: () => string;
  readonly #resolveRoles?: ChallengeApplicationServiceOptions['resolveRoles'];

  constructor(repository: Repository, options: ChallengeApplicationServiceOptions = {}) {
    this.#repository = repository;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#id = options.id ?? randomUUID;
    this.#resolveRoles = options.resolveRoles;
  }

  async submit(ownerId: string, input: { material: unknown; declaration: unknown }): Promise<ExtensionApplication> {
    const owner = actor(ownerId);
    const candidate = material(input.material);
    const declaration = text(input.declaration, 'declaration', 4_000);
    const duplicate = (await this.#repository.read('animationChallenges', { slug: candidate.slug }))[0];
    ensure(!duplicate, 'A published challenge already uses this slug.', 409, ERROR_CODES.CONCURRENT_SAVE);
    const now = this.#now();
    const application: ExtensionApplication = {
      id: this.#id(), ownerId: owner, extensionType: 'artifact-challenge', source: 'artifact-arena',
      permissionDeclaration: declaration, materials: candidate, status: 'submitted',
      createdAt: now, updatedAt: now, decidedAt: null,
    };
    await this.#repository.insert('extensionApplications', [application]);
    return structuredClone(application);
  }

  async listOwned(ownerId: string): Promise<ExtensionApplication[]> {
    return structuredClone((await this.#repository.read('extensionApplications', {
      ownerId: actor(ownerId), extensionType: 'artifact-challenge',
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async review(reviewerId: string, applicationId: string, input: { decision: unknown; reason: unknown }): Promise<ExtensionApplication> {
    const reviewer = actor(reviewerId);
    const roles = await this.#resolveRoles?.(reviewer) ?? new Set<'reviewer' | 'admin'>();
    const roleSet = roles instanceof Set ? roles : new Set(roles);
    ensure(roleSet.has('reviewer') || roleSet.has('admin'), 'Reviewer authorization is required.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
    const decision = input.decision;
    ensure(decision === 'approved' || decision === 'rejected',
      'A valid review decision is required.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    text(input.reason, 'reason', 4_000);

    let result: ExtensionApplication | undefined;
    await this.#repository.transaction(async (tx) => {
      const application = (await tx.read('extensionApplications', {
        id: applicationId, extensionType: 'artifact-challenge',
      }))[0];
      ensure(application, 'Challenge application not found.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      ensure(application.ownerId !== reviewer, 'Authors cannot review their own challenge.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
      ensure(application.status === 'submitted' || application.status === 'in_review',
        'This challenge application has already been decided.', 409, ERROR_CODES.CONCURRENT_SAVE);
      const now = this.#now();
      const updated = await tx.update('extensionApplications', {
        id: application.id, status: application.status,
      }, { status: decision, updatedAt: now, decidedAt: now });
      ensure(updated.length === 1, 'The challenge application changed before review.', 409, ERROR_CODES.CONCURRENT_SAVE);
      result = updated[0];

      if (decision === 'approved') {
        const candidate = material(application.materials);
        ensure(!(await tx.read('animationChallenges', { slug: candidate.slug }))[0],
          'A challenge with this slug was published while the application was under review.', 409, ERROR_CODES.CONCURRENT_SAVE);
        const rows = await tx.read('animationChallenges');
        const position = Math.max(0, ...rows.map((row) => row.position)) + 1;
        const challengeId = `animation-${candidate.slug}`;
        const versionId = `${challengeId}-v1`;
        const versionContent = {
          id: versionId,
          challengeId,
          versionNumber: 1,
          title: candidate.title,
          titleEn: candidate.titleEn,
          instructions: candidate.instructions,
          instructionsEn: candidate.instructionsEn,
          outputPolicyVersion: 'svg-animation-v1' as const,
        };
        await tx.insert('animationChallenges', [{ id: challengeId, slug: candidate.slug, position, status: 'published' }]);
        await tx.insert('animationChallengeVersions', [{
          ...versionContent,
          contentDigest: animationChallengeDigest(versionContent),
        }]);
      }
    });
    return structuredClone(result!);
  }
}
