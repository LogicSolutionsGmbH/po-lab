/**
 * @logic/entity-resolution — capability #1 of the Logic SDK.
 *
 * In-process, deterministic, never-guess. A host imports this and passes its own live Kysely
 * connection; the SDK inherits the host's auth/connection (no token, no network hop).
 */

export { resolveEntity, type ResolveOptions } from './resolve';

export { kyselyExecutor, type QueryExecutor } from './core/executor';
export { ResolutionInfraError } from './core/errors';
export {
  DEFAULT_CONFIG,
  DEFAULT_DIRECTORY_PROFILE,
  LEGAL_SUFFIXES,
  resolveConfig,
  type ResolveConfig,
  type SearchProfile,
} from './core/config';
export {
  consoleLogger,
  noopLogger,
  type Logger,
  type ResolveObservation,
} from './core/logging';
export type {
  EntityResolutionStatus,
  MatchTier,
  ResolutionCandidate,
  ResolutionSignals,
  ResolutionStatus,
  ResolveEntityInput,
  ResolveEntityResult,
} from './core/result';

export { readLearnedAlias, type LearnedAliasHit } from './alias';
export { selectAddress, type AddressResolution } from './address';
