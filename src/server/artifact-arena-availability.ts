import { piRuntimeEnabled, resolvePiRuntimeGate } from './environment.ts';

export type ArtifactArenaFeatureReason =
  | 'enabled'
  | 'kill_switch'
  | 'feature_disabled'
  | 'dependency_unavailable'
  | 'node_engine';

export interface ArtifactArenaFeatureState {
  readonly enabled: boolean;
  readonly reason: ArtifactArenaFeatureReason;
}

export interface ArtifactArenaAvailability {
  /** A kill switch stops new Arena work but does not revoke historical reads. */
  readonly killSwitchActive: boolean;
  readonly historicalReads: ArtifactArenaFeatureState;
  readonly builderDesign: ArtifactArenaFeatureState;
  readonly artifactPreviewProjection: ArtifactArenaFeatureState;
  readonly artifactRead: ArtifactArenaFeatureState;
  readonly creationRuns: ArtifactArenaFeatureState;
  readonly showcase: ArtifactArenaFeatureState;
  readonly voting: ArtifactArenaFeatureState;
  readonly piRuntime: ArtifactArenaFeatureState;
}

function exactTrue(env: Record<string, string | undefined>, key: string): boolean {
  return env[key] === 'true';
}

function disabledState(
  env: Record<string, string | undefined>,
  killSwitchActive: boolean
): ArtifactArenaFeatureState {
  return killSwitchActive
    ? { enabled: false, reason: 'kill_switch' }
    : exactTrue(env, 'ARTIFACT_ARENA_ENABLED')
      ? { enabled: false, reason: 'dependency_unavailable' }
      : { enabled: false, reason: 'feature_disabled' };
}

/**
 * Public, non-secret capability projection for boot/UI decisions.
 *
 * This function intentionally reports the current implementation gates rather
 * than treating environment variables as proof that production dependencies
 * exist. In particular, live artifact storage, CreationRun EF wiring,
 * Showcase/Voting persistence, and Pi execution remain disabled until their
 * durable providers are injected and verified.
 */
export function artifactArenaAvailability(
  env: Record<string, string | undefined>,
  nodeVersion = process.version
): ArtifactArenaAvailability {
  const killSwitchActive = exactTrue(env, 'ARTIFACT_ARENA_KILL_SWITCH');
  const configured = exactTrue(env, 'ARTIFACT_ARENA_ENABLED');
  const active = configured && !killSwitchActive;
  const unavailable = disabledState(env, killSwitchActive);
  const projectionState: ArtifactArenaFeatureState = active
    ? { enabled: true, reason: 'enabled' }
    : unavailable;
  const dependencyUnavailable: ArtifactArenaFeatureState = {
    enabled: false,
    reason: 'dependency_unavailable',
  };

  const piGate = resolvePiRuntimeGate(env, nodeVersion);
  const piRuntime: ArtifactArenaFeatureState = !active
    ? unavailable
    : piGate.ok
      ? dependencyUnavailable
      : piGate.reason === 'node_engine'
        ? { enabled: false, reason: 'node_engine' }
        : { enabled: false, reason: 'feature_disabled' };
  const historicalReads: ArtifactArenaFeatureState = {
    enabled: true,
    reason: 'enabled',
  };

  return Object.freeze({
    killSwitchActive,
    historicalReads,
    builderDesign: projectionState,
    artifactPreviewProjection: projectionState,
    // These are deliberately false even when the top-level flag is true. A
    // flag expresses operator intent; it cannot substitute for durable wiring.
    artifactRead: active ? dependencyUnavailable : unavailable,
    creationRuns: active ? dependencyUnavailable : unavailable,
    showcase: active ? dependencyUnavailable : unavailable,
    voting: active ? dependencyUnavailable : unavailable,
    piRuntime,
  });
}
