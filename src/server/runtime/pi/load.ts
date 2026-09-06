import { AppError, ERROR_CODES, ensure } from '../../../shared/errors.ts';
import type { Pricing } from '../../../lib/scoring/index.ts';
import { resolvePiRuntimeGate } from '../../environment.ts';
import { PiRuntimeAdapter, type PiRuntimeGateFn } from './adapter.ts';
import { createBridgeAStreamFn, type BridgeAConfig } from './bridge-a.ts';
import { PI_CORE_PACKAGE, type PiCreateAgent, type PiModule } from './package.ts';
import { toPiProtocolStreamFn } from './protocol.ts';
import type { ControlledStreamFn } from './stream-fn.ts';

const UNAVAILABLE_MESSAGE = 'This runtime is not available in the current environment.';

export type PiCoreImporter = (specifier: string) => Promise<unknown>;

export type LoadPiCoreOptions = {
  env?: Record<string, string | undefined>;
  nodeVersion?: string;
  resolveGate?: PiRuntimeGateFn;
  importModule?: PiCoreImporter;
};

export type PiInstalledStreamSource = 'injected' | 'bridge-a' | 'bridge-b';

export type CreatePiAdapterFromInstallOptions = LoadPiCoreOptions & {
  streamFn?: ControlledStreamFn;
  streamSource?: PiInstalledStreamSource;
  bridge?: BridgeAConfig;
  wrapProtocol?: boolean;
  pricing?: Pricing;
  now?: () => number;
};

function unavailable(): never {
  throw new AppError(UNAVAILABLE_MESSAGE, 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function duckTypePiModule(value: unknown): PiModule {
  ensure(
    isRecord(value) && typeof value.Agent === 'function',
    UNAVAILABLE_MESSAGE,
    503,
    ERROR_CODES.RUNTIME_UNAVAILABLE
  );
  return { Agent: value.Agent as PiModule['Agent'] };
}

function createAgentFromModule(loaded: PiModule): PiCreateAgent {
  return (options) => new loaded.Agent(options);
}

/**
 * Load `@earendil-works/pi-agent-core` only after the flag and Node gate pass.
 * The specifier is a widened string so typecheck does not resolve the optional package.
 */
export async function loadPiCoreModule(options: LoadPiCoreOptions = {}): Promise<PiModule> {
  const env = options.env ?? process.env;
  const nodeVersion = options.nodeVersion ?? process.version;
  const resolveGate = options.resolveGate ?? resolvePiRuntimeGate;
  if (!resolveGate(env, nodeVersion).ok) unavailable();

  const specifier: string = PI_CORE_PACKAGE;
  const importer = options.importModule ?? ((id: string) => import(/* webpackIgnore: true */ id));
  try {
    return duckTypePiModule(await importer(specifier));
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.RUNTIME_UNAVAILABLE) throw error;
    unavailable();
  }
}

function resolveInjectedStreamFn(options: CreatePiAdapterFromInstallOptions): ControlledStreamFn {
  if (options.streamSource === 'bridge-b') unavailable();
  if (options.streamSource === 'bridge-a') return createBridgeAStreamFn(options.bridge);
  if (typeof options.streamFn !== 'function') unavailable();
  return options.streamFn;
}

function createAgentForInstall(
  loaded: PiModule,
  wrapProtocol: boolean
): PiCreateAgent {
  const createAgent = createAgentFromModule(loaded);
  if (!wrapProtocol) return createAgent;
  return (agentOptions) => {
    const streamFn = agentOptions.streamFn;
    if (typeof streamFn !== 'function') unavailable();
    return createAgent({
      ...agentOptions,
      streamFn: toPiProtocolStreamFn(streamFn as ControlledStreamFn)
    });
  };
}

export async function createPiAdapterFromInstall(
  options: CreatePiAdapterFromInstallOptions = {}
): Promise<PiRuntimeAdapter> {
  const loaded = await loadPiCoreModule(options);
  const streamFn = resolveInjectedStreamFn(options);
  return new PiRuntimeAdapter({
    createAgent: createAgentForInstall(loaded, options.wrapProtocol === true),
    streamFn,
    resolveGate: options.resolveGate,
    env: options.env,
    nodeVersion: options.nodeVersion,
    pricing: options.pricing,
    now: options.now
  });
}
