/** Test models require an explicit environment, never NODE_ENV or an old Demo flag alone. */
export function testModelsEnabled(env: Record<string, string | undefined>): boolean {
  return env.APP_ENV === 'test' && env.DEMO_MODE === 'true';
}

/**
 * Pi is opt-in via the exact string 'true'. Unset, '1', 'yes', and 'TRUE' stay off.
 * Independent of APP_ENV and DEMO_MODE so test models cannot accidentally enable it.
 */
export function piRuntimeEnabled(env: Record<string, string | undefined>): boolean {
  return env.PI_RUNTIME_ENABLED === 'true';
}

/** Frozen Pi engines.node. The app baseline stays >=22.16.0; older Node must refuse Pi. */
export const PI_RUNTIME_MIN_NODE = '22.19.0';

export type PiRuntimeGate =
  | { ok: true }
  | { ok: false; reason: 'flag_off' | 'node_engine' };

function parseNodeVersion(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function nodeMeetsPiEngine(version: string): boolean {
  const parsed = parseNodeVersion(version);
  const required = parseNodeVersion(PI_RUNTIME_MIN_NODE);
  if (!parsed || !required) return false;
  for (let index = 0; index < 3; index += 1) {
    if (parsed[index] > required[index]) return true;
    if (parsed[index] < required[index]) return false;
  }
  return true;
}

export function resolvePiRuntimeGate(
  env: Record<string, string | undefined>,
  nodeVersion: string
): PiRuntimeGate {
  if (!piRuntimeEnabled(env)) return { ok: false, reason: 'flag_off' };
  if (!nodeMeetsPiEngine(nodeVersion)) return { ok: false, reason: 'node_engine' };
  return { ok: true };
}

export function piInvitedEmails(env: Record<string, string | undefined>): string[] {
  return (env.PI_RUNTIME_INVITED_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export type PiAccess = 'applied' | 'invited';

export function isPiInvited(
  email: string,
  access: string | null | undefined,
  env: Record<string, string | undefined>
): boolean {
  if (access === 'invited') return true;
  return piInvitedEmails(env).includes(email.trim().toLowerCase());
}
