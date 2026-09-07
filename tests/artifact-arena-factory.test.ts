import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArenaService } from '../src/server/service.ts';
import { handleArena } from '../src/server/http.ts';

const ORIGIN = 'http://localhost:3000';

function arenaService(env: Record<string, string | undefined>): ArenaService {
  return {
    limit: async () => undefined,
    options: { env },
  } as unknown as ArenaService;
}

test('default route composition remains fail-closed when durable Arena services are not configured', async () => {
  const response = await handleArena(new Request(`${ORIGIN}/api/arena/artifact-bundles/bundle-1`), {
    service: arenaService({ ARTIFACT_ARENA_ENABLED: 'true' }),
    userId: 'owner-1',
    origin: ORIGIN,
    // The production route passes getArtifactArenaServices() here. With no
    // explicitly injected object-storage adapter it must return undefined.
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'RUNTIME_UNAVAILABLE',
      message: 'Artifact reading is not available.',
    },
  });
});
