import { randomUUID } from 'node:crypto';
import type { Repository, WorkLike } from '../../shared/types.ts';
import { AppError, ERROR_CODES, ensure } from '../../shared/errors.ts';

export interface WorkLikeSummary {
  readonly publicationId: string;
  readonly count: number;
  readonly likedByViewer: boolean;
}

export interface WorkLikeMutation extends WorkLikeSummary {
  readonly changed: boolean;
}

export interface WorkLikeServiceOptions {
  readonly now?: () => string;
  readonly id?: () => string;
}

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { code?: unknown; cause?: unknown };
  if (typeof record.code === 'string') return record.code;
  return databaseErrorCode(record.cause);
}

/**
 * Independent appreciation signal. Likes never mutate showcase votes, trust
 * lanes, community scores, or leaderboard qualification.
 */
export class WorkLikeService {
  private readonly repository: Repository;
  private readonly now: () => string;
  private readonly id: () => string;

  constructor(repository: Repository, options: WorkLikeServiceOptions = {}) {
    this.repository = repository;
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? randomUUID;
  }

  async summary(publicationId: string, viewerId?: string): Promise<WorkLikeSummary> {
    await this.requirePublished(publicationId);
    const likes = await this.repository.read('workLikes', { publicationId });
    return {
      publicationId,
      count: likes.length,
      likedByViewer: Boolean(viewerId && likes.some((like) => like.userId === viewerId)),
    };
  }

  async like(userId: string, publicationId: string): Promise<WorkLikeMutation> {
    const publication = await this.requirePublished(publicationId);
    ensure(publication.ownerId !== userId, 'You cannot like your own work.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
    ensure(await this.repository.rateLimit(`work-like:${userId}`, 120, 60 * 60 * 1000), 'Like rate limit exceeded.', 429, ERROR_CODES.RATE_LIMITED);

    let changed: boolean;
    try {
      changed = await this.repository.transaction(async (tx) => {
        const existing = (await tx.read('workLikes', { userId, publicationId }))[0];
        if (existing) return false;
        const row: WorkLike = { id: this.id(), publicationId, userId, createdAt: this.now() };
        await tx.insert('workLikes', [row]);
        return true;
      });
    } catch (error) {
      // Concurrent PUTs may both observe no row before the database uniqueness
      // constraint wins. Treat the committed matching row as an idempotent replay.
      const existing = (await this.repository.read('workLikes', { userId, publicationId }))[0];
      if (databaseErrorCode(error) !== '23505' || !existing) throw error;
      changed = false;
    }
    const summary = await this.summary(publicationId, userId);
    return { ...summary, changed };
  }

  async unlike(userId: string, publicationId: string): Promise<WorkLikeMutation> {
    await this.requirePublished(publicationId);
    ensure(await this.repository.rateLimit(`work-like:${userId}`, 120, 60 * 60 * 1000), 'Like rate limit exceeded.', 429, ERROR_CODES.RATE_LIMITED);
    const changed = await this.repository.transaction(async (tx) => {
      const existing = (await tx.read('workLikes', { userId, publicationId }))[0];
      if (!existing) return false;
      await tx.remove('workLikes', { id: existing.id });
      return true;
    });
    const summary = await this.summary(publicationId, userId);
    return { ...summary, changed };
  }

  private async requirePublished(publicationId: string) {
    ensure(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u.test(publicationId), 'Invalid publication id.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    const publication = (await this.repository.read('workPublications', { id: publicationId }))[0];
    if (!publication || publication.status !== 'published') {
      throw new AppError('Published work not found.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
    }
    return publication;
  }
}
