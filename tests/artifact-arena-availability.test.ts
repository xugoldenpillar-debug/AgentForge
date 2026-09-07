import assert from 'node:assert/strict';
import test from 'node:test';
import { artifactArenaAvailability } from '../src/server/artifact-arena-availability.ts';

test('Artifact Arena stays unavailable by default while historical reads remain enabled', () => {
  const availability = artifactArenaAvailability({}, '22.19.0');

  assert.equal(availability.historicalReads.enabled, true);
  assert.equal(availability.historicalReads.reason, 'enabled');
  assert.deepEqual(availability.builderDesign, { enabled: false, reason: 'feature_disabled' });
  assert.deepEqual(availability.artifactPreviewProjection, { enabled: false, reason: 'feature_disabled' });
  assert.deepEqual(availability.artifactRead, { enabled: false, reason: 'feature_disabled' });
  assert.deepEqual(availability.creationRuns, { enabled: false, reason: 'feature_disabled' });
  assert.deepEqual(availability.showcase, { enabled: false, reason: 'feature_disabled' });
  assert.deepEqual(availability.voting, { enabled: false, reason: 'feature_disabled' });
  assert.deepEqual(availability.piRuntime, { enabled: false, reason: 'feature_disabled' });
  assert.equal(availability.killSwitchActive, false);
});

test('operator intent enables only design and safe preview projections until durable dependencies exist', () => {
  const availability = artifactArenaAvailability({ ARTIFACT_ARENA_ENABLED: 'true' }, '22.19.0');

  assert.deepEqual(availability.builderDesign, { enabled: true, reason: 'enabled' });
  assert.deepEqual(availability.artifactPreviewProjection, { enabled: true, reason: 'enabled' });
  for (const feature of [availability.artifactRead, availability.creationRuns, availability.showcase, availability.voting]) {
    assert.deepEqual(feature, { enabled: false, reason: 'dependency_unavailable' });
  }
  assert.deepEqual(availability.piRuntime, { enabled: false, reason: 'feature_disabled' });
});

test('the Arena kill switch disables new capabilities without revoking historical reads', () => {
  const availability = artifactArenaAvailability({
    ARTIFACT_ARENA_ENABLED: 'true',
    ARTIFACT_ARENA_KILL_SWITCH: 'true',
  }, '22.19.0');

  assert.equal(availability.killSwitchActive, true);
  assert.deepEqual(availability.historicalReads, { enabled: true, reason: 'enabled' });
  assert.deepEqual(availability.builderDesign, { enabled: false, reason: 'kill_switch' });
  assert.deepEqual(availability.artifactPreviewProjection, { enabled: false, reason: 'kill_switch' });
  assert.deepEqual(availability.artifactRead, { enabled: false, reason: 'kill_switch' });
  assert.deepEqual(availability.creationRuns, { enabled: false, reason: 'kill_switch' });
  assert.deepEqual(availability.showcase, { enabled: false, reason: 'kill_switch' });
  assert.deepEqual(availability.voting, { enabled: false, reason: 'kill_switch' });
  assert.deepEqual(availability.piRuntime, { enabled: false, reason: 'kill_switch' });
});

test('Pi Arena execution retains the Pi flag and Node gate but remains dependency-gated', () => {
  const enabled = artifactArenaAvailability({
    ARTIFACT_ARENA_ENABLED: 'true',
    PI_RUNTIME_ENABLED: 'true',
  }, '22.19.0');
  assert.deepEqual(enabled.piRuntime, { enabled: false, reason: 'dependency_unavailable' });

  const oldNode = artifactArenaAvailability({
    ARTIFACT_ARENA_ENABLED: 'true',
    PI_RUNTIME_ENABLED: 'true',
  }, '22.18.9');
  assert.deepEqual(oldNode.piRuntime, { enabled: false, reason: 'node_engine' });

  const malformedFlag = artifactArenaAvailability({
    ARTIFACT_ARENA_ENABLED: 'true',
    PI_RUNTIME_ENABLED: 'TRUE',
  }, '22.19.0');
  assert.deepEqual(malformedFlag.piRuntime, { enabled: false, reason: 'feature_disabled' });
});
