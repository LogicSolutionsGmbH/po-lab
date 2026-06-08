import type { ResolutionStatus, EntityResolutionStatus } from './result';

/** Logging/metrics sink the host supplies. */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Per-resolve observability bundle (HANDOFF-resolve-entity §9). Emitted to the injected logger so
 * threshold tuning and quality claims are evidence-based, not guesswork.
 */
export interface ResolveObservation {
  signal_completeness: {
    has_name: boolean;
    has_tax_id: boolean;
    has_eori: boolean;
    has_country: boolean;
    has_city: boolean;
    candidate_name_count: number;
  };
  status: EntityResolutionStatus;
  resolution_status: ResolutionStatus;
  ambiguity_type: 'entity' | 'address' | null;
  candidate_count: number;
  alias_hit: boolean;
  latency_ms: number;
}

export const consoleLogger: Logger = {
  debug: (m, meta) => console.debug(m, meta ?? ''),
  info: (m, meta) => console.info(m, meta ?? ''),
  warn: (m, meta) => console.warn(m, meta ?? ''),
  error: (m, meta) => console.error(m, meta ?? ''),
};

/** No-op sink (default when a host supplies none). */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
