import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../src/features/builder/agent-builder-page.tsx', import.meta.url);
const previewUrl = new URL('../src/components/agent/artifact-preview.tsx', import.meta.url);

test('Artifact Arena creation UI uses the durable product APIs and contains no fixture preview path', async () => {
  const [source, previewSource] = await Promise.all([
    readFile(pageUrl, 'utf8'),
    readFile(previewUrl, 'utf8'),
  ]);

  for (const stale of ['FIXTURE_FILES', 'PREVIEW_FILES', 'Design mode only', 'static local preview']) {
    assert.doesNotMatch(source, new RegExp(stale, 'i'));
  }

  for (const api of [
    'saveAgentBuild',
    'createCreationRun',
    'getCreationRun',
    'cancelCreationRun',
    'retryCreationRun',
    'getArtifactBundle',
    'getArtifactPreview',
    'downloadArtifact',
    'requestPublication',
    'createShowcaseEntry',
    'issueShowcaseBallot',
    'castShowcaseVote',
    'getShowcaseLeaderboard',
    'likePublication',
    'unlikePublication',
    'forkAgentBuild',
  ]) {
    assert.match(source, new RegExp(`\\b${api}\\b`), `${api} must remain wired into the creation UI`);
  }

  assert.match(source, /roundId\(challengeVersionId\)/);
  assert.match(source, /season-2026-launch/);
  assert.match(source, /ArtifactPreviewPanel/);
  assert.match(source, /publishConfirmed/);
  assert.match(source, /publishConfirmed: true/);
  assert.match(source, /!previewReady \|\| !publishConfirmed/, 'publishing requires a loaded index.html preview and explicit owner confirmation');
  assert.match(previewSource, /requestFullscreen/);
  assert.match(previewSource, /styles\.fileTree/);
  assert.match(previewSource, /exitFullscreen/);
  assert.doesNotMatch(source, /sourceLabel="sealed \/ no-script"/);
  assert.match(source, /row\.qualified \? String\(index \+ 1\).*: '—'/, 'unqualified entries must not receive a displayed rank');
  assert.match(source, /votes: row\.comparisons, voters: row\.validVoters/, 'each leaderboard row must display its own effective sample');
});
