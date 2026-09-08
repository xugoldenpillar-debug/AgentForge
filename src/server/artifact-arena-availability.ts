import path from 'node:path';
import { resolvePiRuntimeGate } from './environment.ts';

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

function value(env: Record<string, string | undefined>, key: string): string | undefined {
  return env[key]?.trim() || undefined;
}

function absoluteConfigured(env: Record<string, string | undefined>, key: string): boolean {
  const configured = value(env, key);
  return Boolean(configured && path.isAbsolute(configured));
}

function state(enabled: boolean, reason: ArtifactArenaFeatureReason): ArtifactArenaFeatureState {
  return Object.freeze({ enabled, reason });
}

function inactiveState(configured: boolean, killSwitchActive: boolean): ArtifactArenaFeatureState {
  if (killSwitchActive) return state(false, 'kill_switch');
  return state(false, configured ? 'dependency_unavailable' : 'feature_disabled');
}

/**
 * Public, non-secret capability projection for boot/UI decisions.
 *
 * A feature flag expresses operator intent. Durable features are advertised only
 * when their non-secret configuration is complete; the concrete composition
 * root and worker still validate connectivity, paths, ownership and digests.
 */
export function artifactArenaAvailability(
  env: Record<string, string | undefined>,
  nodeVersion = process.version,
): ArtifactArenaAvailability {
  const configured = exactTrue(env, 'ARTIFACT_ARENA_ENABLED');
  const killSwitchActive = exactTrue(env, 'ARTIFACT_ARENA_KILL_SWITCH');
  const active = configured && !killSwitchActive;
  const inactive = inactiveState(configured, killSwitchActive);
  const enabled = state(true, 'enabled');
  const dependencyUnavailable = state(false, 'dependency_unavailable');

  const storageConfigured = absoluteConfigured(env, 'ARTIFACT_STORAGE_ROOT');
  const schedulerConfigured = value(env, 'EVALUATION_SCHEDULER_MODE') === 'outbox';
  const workerControlPlaneConfigured = schedulerConfigured
    && ['DATABASE_URL', 'REDIS_URL', 'EVALUATION_QUEUE_NAME', 'EVALUATION_QUEUE_PREFIX',
      'EVALUATION_WORKER_ID', 'CREDENTIAL_ENCRYPTION_KEY', 'ARTIFACT_STORAGE_GID']
      .every((key) => Boolean(value(env, key)));
  const sandboxConfigured = ['SANDBOX_RUNSC_PATH', 'SANDBOX_ROOTFS', 'SANDBOX_WORK_ROOT',
    'SANDBOX_OCI_TEMPLATE'].every((key) => absoluteConfigured(env, key))
    && /^sha256:[a-f0-9]{64}$/u.test(value(env, 'SANDBOX_IMAGE_DIGEST') ?? '');

  const durableRead = configured && storageConfigured ? enabled : configured ? dependencyUnavailable : inactive;
  const mutableDurable = active && storageConfigured ? enabled : inactive;
  const creationRuns = active && storageConfigured && schedulerConfigured ? enabled : inactive;

  const piGate = resolvePiRuntimeGate(env, nodeVersion);
  let piRuntime = inactive;
  if (active) {
    if (!piGate.ok) {
      piRuntime = state(false, piGate.reason === 'node_engine' ? 'node_engine' : 'feature_disabled');
    } else if (storageConfigured && workerControlPlaneConfigured && sandboxConfigured) {
      piRuntime = enabled;
    } else {
      piRuntime = dependencyUnavailable;
    }
  }

  return Object.freeze({
    killSwitchActive,
    historicalReads: enabled,
    builderDesign: active ? enabled : inactive,
    artifactPreviewProjection: active ? enabled : inactive,
    // Reads remain available through a kill switch when immutable storage is
    // configured. All mutation routes use the separate active-state gates.
    artifactRead: durableRead,
    creationRuns,
    showcase: mutableDurable,
    voting: mutableDurable,
    piRuntime,
  });
}
