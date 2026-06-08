/**
 * Capability #1 — entity resolution. Pure function over an injected executor (api_shape=A).
 *
 *   resolveEntity(executor, { tenantId, signals, confirm_match }, options?)
 *
 * Deterministic, never-guess. Pipeline:
 *   1. learned-alias DB short-circuit (read-only, deterministic)
 *   2. candidate_names best-of (wrapper-level, with ambiguity guard)
 *   3. ported matcher kernel → internal entity profile
 *   4. thin mapping → flat §4.2 contract (address selection + resolution_status derivation)
 * Infra failures throw `ResolutionInfraError`; business outcomes are returned, never thrown.
 */

import { selectAddress, type AddressResolution } from './address';
import { readLearnedAlias } from './alias';
import { resolveConfig, type ResolveConfig } from './core/config';
import { ResolutionInfraError } from './core/errors';
import type { QueryExecutor } from './core/executor';
import { noopLogger, type Logger, type ResolveObservation } from './core/logging';
import type {
  ResolutionCandidate,
  ResolveEntityInput,
  ResolveEntityResult,
} from './core/result';
import { NotFoundError } from './engine/queries';
import { resolveDirectory } from './engine/resolver';
import type { DirectoryResolveResponse, ResolveSignals } from './engine/types';

export interface ResolveOptions {
  config?: Partial<ResolveConfig>;
  logger?: Logger;
}

const NOT_FOUND_INTERNAL: DirectoryResolveResponse = {
  resolution: 'not_found',
  confidence: null,
  entity: null,
  candidates: [],
  reasoning: 'No entity matched for the provided signals.',
};

function toResolveSignals(input: ResolveEntityInput['signals']): ResolveSignals {
  const { candidate_names: _omit, ...rest } = input;
  return rest;
}

function mapCandidates(internal: DirectoryResolveResponse['candidates']): ResolutionCandidate[] {
  return internal.map((c) => ({
    entity_id: Number(c.entity_id),
    entity_address_id: null,
    name: c.entity_name,
    country: null,
    city: null,
    tenant: null,
    active: true,
    confidence: c.confidence,
    match_tier: c.match_tier,
  }));
}

function mapInternal(
  internal: DirectoryResolveResponse,
  signals: ResolveEntityInput['signals'],
  aliasHit: boolean,
  addressOverride?: AddressResolution,
): ResolveEntityResult {
  const hints = internal.hints ?? [];

  if (internal.resolution === 'not_found') {
    return {
      status: 'not_found',
      entity_id: null,
      entity_address_id: null,
      resolution_status: 'not_found',
      confidence: null,
      candidates: mapCandidates(internal.candidates),
      reason: internal.reasoning,
      hints,
      alias_hit: aliasHit,
    };
  }

  if (internal.resolution === 'ambiguous') {
    return {
      status: 'ambiguous',
      entity_id: null,
      entity_address_id: null,
      resolution_status: 'ambiguous_entity',
      confidence: null,
      candidates: mapCandidates(internal.candidates),
      reason: internal.reasoning,
      hints,
      alias_hit: aliasHit,
    };
  }

  const entity = internal.entity!;
  const addr = addressOverride ?? selectAddress(entity.addresses, signals);

  return {
    status: addr.resolution_status === 'resolved' ? 'resolved' : 'ambiguous',
    entity_id: entity.entity_id,
    entity_address_id: addr.entity_address_id,
    resolution_status: addr.resolution_status,
    confidence: internal.confidence,
    candidates: [],
    reason: internal.reasoning,
    hints,
    alias_hit: aliasHit,
  };
}

function buildObservation(
  signals: ResolveEntityInput['signals'],
  result: ResolveEntityResult,
  latencyMs: number,
): ResolveObservation {
  return {
    signal_completeness: {
      has_name: !!signals.entity_name,
      has_tax_id: !!signals.tax_id,
      has_eori: !!signals.eori,
      has_country: !!signals.country_code,
      has_city: !!signals.city,
      candidate_name_count: signals.candidate_names?.length ?? 0,
    },
    status: result.status,
    resolution_status: result.resolution_status,
    ambiguity_type:
      result.resolution_status === 'ambiguous_entity'
        ? 'entity'
        : result.resolution_status === 'ambiguous_address'
          ? 'address'
          : null,
    candidate_count: result.candidates.length,
    alias_hit: result.alias_hit,
    latency_ms: latencyMs,
  };
}

export async function resolveEntity(
  executor: QueryExecutor,
  input: ResolveEntityInput,
  options: ResolveOptions = {},
): Promise<ResolveEntityResult> {
  const config = resolveConfig(options.config);
  const logger = options.logger ?? noopLogger;
  const start = Date.now();
  const { tenantId, signals } = input;
  const baseSignals = toResolveSignals(signals);

  try {
    let result: ResolveEntityResult;

    // 1. Learned-alias short-circuit (skip when caller explicitly confirms an entity).
    if (config.useLearnedAlias && !input.confirm_match) {
      const hit = await readLearnedAlias(executor, tenantId, signals, config.profile, logger);
      if (hit) {
        try {
          const internal = await resolveDirectory(
            executor,
            { signals: baseSignals, confirm_match: { entity_id: hit.entity_id } },
            tenantId,
            config.profile,
          );
          const override: AddressResolution | undefined =
            hit.entity_address_id !== null
              ? { entity_address_id: hit.entity_address_id, resolution_status: 'resolved' }
              : undefined;
          result = mapInternal(internal, signals, true, override);
          logger.info('[resolve] learned-alias hit', { tenantId, entity_id: hit.entity_id });
          return finish(result);
        } catch (error) {
          if (error instanceof NotFoundError) {
            logger.warn('[resolve] stale learned-alias ignored', { tenantId, entity_id: hit.entity_id });
          } else {
            throw error;
          }
        }
      }
    }

    // 2. candidate_names best-of (wrapper-level, deterministic ambiguity guard).
    const candidateNames = dedupeNames(signals.entity_name, signals.candidate_names);
    if (candidateNames.length > 1) {
      result = await resolveAcrossCandidateNames(executor, tenantId, signals, candidateNames, config);
      return finish(result);
    }

    // 3. Single matcher run.
    const internal = await resolveDirectory(
      executor,
      { signals: baseSignals, confirm_match: input.confirm_match ?? null },
      tenantId,
      config.profile,
    ).catch((error) => {
      if (error instanceof NotFoundError) return NOT_FOUND_INTERNAL;
      throw error;
    });
    result = mapInternal(internal, signals, false);
    return finish(result);
  } catch (error) {
    if (error instanceof ResolutionInfraError) {
      logger.error('[resolve] infrastructure failure', { tenantId, message: error.message });
      throw error;
    }
    const wrapped = new ResolutionInfraError('Unexpected resolution failure', error);
    logger.error('[resolve] unexpected failure', { tenantId, message: wrapped.message });
    throw wrapped;
  }

  function finish(result: ResolveEntityResult): ResolveEntityResult {
    const observation = buildObservation(signals, result, Date.now() - start);
    logger.info('[resolve] observation', observation as unknown as Record<string, unknown>);
    return result;
  }
}

async function resolveAcrossCandidateNames(
  db: QueryExecutor,
  tenantId: number,
  signals: ResolveEntityInput['signals'],
  names: string[],
  config: ResolveConfig,
): Promise<ResolveEntityResult> {
  const base = toResolveSignals(signals);
  const matched: DirectoryResolveResponse[] = [];

  for (const name of names) {
    const internal = await resolveDirectory(
      db,
      { signals: { ...base, entity_name: name }, confirm_match: null },
      tenantId,
      config.profile,
    ).catch((error) => {
      if (error instanceof NotFoundError) return NOT_FOUND_INTERNAL;
      throw error;
    });
    if (internal.resolution === 'matched' && internal.entity) {
      matched.push(internal);
    }
  }

  const distinctEntityIds = new Set(matched.map((m) => m.entity!.entity_id));

  if (distinctEntityIds.size === 1) {
    const best = matched.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
    return mapInternal(best, signals, false);
  }

  if (distinctEntityIds.size > 1) {
    // Different candidate names resolve to different entities → never silently pick.
    const ambiguous: DirectoryResolveResponse = {
      resolution: 'ambiguous',
      confidence: null,
      entity: null,
      candidates: matched.map((m) => ({
        entity_id: m.entity!.entity_id,
        entity_name: m.entity!.entity_name,
        confidence: m.confidence ?? 0,
        match_tier: 'strong',
        matched_fields: [],
      })),
      reasoning: 'candidate_names resolved to multiple distinct entities; confirmation required.',
    };
    return mapInternal(ambiguous, signals, false);
  }

  // No candidate name matched → not_found.
  return mapInternal(NOT_FOUND_INTERNAL, signals, false);
}

function dedupeNames(primary: string | null | undefined, candidates?: string[]): string[] {
  const all = [primary, ...(candidates ?? [])]
    .map((n) => (n ?? '').trim())
    .filter((n) => n.length > 0);
  return [...new Set(all)];
}
