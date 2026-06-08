/**
 * Resolver orchestration (ported from journeys resolve-directory.helper.ts `resolveEntity`).
 *
 * Produces the internal `DirectoryResolveResponse` (entity profile incl. all addresses). The SDK
 * layer maps it to the flat §4.2 contract and derives address selection + resolution_status.
 *
 * Removed vs source: the in-memory alias short-circuit and `memorizeSignals` (see ../alias.ts and
 * scoring.ts). Learned-alias is now a deterministic DB read performed before this resolver runs.
 */

import * as fuzzball from 'fuzzball';

import type { SearchProfile } from '../core/config';
import type { QueryExecutor } from '../core/executor';
import { clampScore, normalizeCity, normalizeEntityName, normalizeIdentifier } from './normalize';
import {
  assertEntityExistsForTenant,
  fetchByIdentifier,
  fetchEntityProfileRows,
  fetchResolutionCandidates,
  findRelatedTenantIds,
  NotFoundError,
} from './queries';
import { scoreCandidates } from './scoring';
import type {
  DirectoryEntityAddress,
  DirectoryEntityProfile,
  DirectoryResolveResponse,
  ResolveSignals,
  ScoredCandidate,
} from './types';

export interface DirectoryResolveInput {
  signals: ResolveSignals;
  confirm_match?: { entity_id: number } | null;
}

function rankAddressesBySignals(
  addresses: DirectoryEntityAddress[],
  signals: ResolveSignals,
): DirectoryEntityAddress[] {
  if (addresses.length <= 1 || (!signals.city && !signals.country_code)) return addresses;
  const nc = signals.city ? normalizeCity(signals.city) : '';
  const ng = signals.country_code?.trim().toUpperCase() ?? '';
  return [...addresses].sort((a, b) => {
    let sa = 0;
    let sb = 0;
    if (nc) {
      if (a.city && normalizeCity(a.city) === nc) sa += 10;
      if (b.city && normalizeCity(b.city) === nc) sb += 10;
    }
    if (ng) {
      if (a.country_code?.trim().toUpperCase() === ng) sa += 1;
      if (b.country_code?.trim().toUpperCase() === ng) sb += 1;
    }
    return sb - sa;
  });
}

async function getEntityProfile(
  db: QueryExecutor,
  entityId: number,
  tenantId: number,
  relatedTenantIds?: number[],
): Promise<DirectoryEntityProfile> {
  await assertEntityExistsForTenant(db, tenantId, entityId, relatedTenantIds);

  const { entity, addresses, taxInfo } = await fetchEntityProfileRows(db, entityId, tenantId);
  if (!entity) {
    throw new NotFoundError(`Entity ${entityId} does not exist`);
  }

  const addressIds = addresses.map((address) => Number(address.entity_address_id));

  return {
    entity_id: Number(entity.entity_id),
    entity_name: entity.entity_name,
    addresses,
    tax_info: taxInfo,
    owner_tenant_id: null,
    primary_keys: {
      cd_identityDirectorio: Number(entity.entity_id),
      cd_identityTenant: tenantId,
      cd_identityDirectorioDireccion: addressIds,
      cd_identityDirectorioTaxId: taxInfo?.entity_tax_id ?? null,
    },
  };
}

async function finalizeMatchedEntity(
  db: QueryExecutor,
  tenantId: number,
  entityId: number,
  signals: ResolveSignals,
  relatedTenantIds: number[],
): Promise<DirectoryEntityProfile> {
  const entity = await getEntityProfile(db, entityId, tenantId, relatedTenantIds);
  entity.addresses = rankAddressesBySignals(entity.addresses, signals);
  return entity;
}

function buildSignalHints(signals: ResolveSignals): string[] {
  const strong = !!(signals.entity_name || signals.tax_id || signals.eori);
  return [
    !strong &&
      'Provide entity_name, tax_id, or eori for accurate matching. These are the strongest resolution signals.',
    !signals.entity_name && 'Adding entity_name improves fuzzy and phonetic matching.',
    !signals.tax_id && !signals.eori && 'Adding tax_id or eori enables exact identifier matching.',
    !signals.country_code && 'Adding country_code helps narrow results and corroborate matches.',
    !signals.city && 'Adding city improves address-level corroboration.',
  ].filter((x): x is string => Boolean(x));
}

function pickUniqueIdentifierMatchByEntityName(
  matches: Array<{ entity_id: number; entity_name: string }>,
  signals: ResolveSignals,
  profile: SearchProfile,
): { entity_id: number; entity_name: string; nameScore: number } | null {
  const raw = signals.entity_name?.trim();
  if (!raw) return null;

  const normalizedQuery = normalizeEntityName(raw, profile.legalSuffixes);

  const scored = matches.map((m) => {
    const nb = normalizeEntityName(m.entity_name, profile.legalSuffixes);
    const nameScore =
      normalizedQuery.length > 0 && nb === normalizedQuery
        ? 100
        : clampScore(fuzzball.token_set_ratio(nb, normalizedQuery));
    return { entity_id: m.entity_id, entity_name: m.entity_name, nameScore };
  });

  scored.sort((a, b) => b.nameScore - a.nameScore);
  const top = scored[0];
  const second = scored[1];
  if (!top || top.nameScore < profile.thresholds.minimum) return null;

  const isClearWinner =
    top.nameScore > profile.thresholds.strong &&
    (!second ||
      top.nameScore - second.nameScore >= 8 ||
      (top.nameScore >= 100 && second.nameScore < 100));

  return isClearWinner ? top : null;
}

function mapResolutionCandidates(
  candidates: ScoredCandidate[],
): DirectoryResolveResponse['candidates'] {
  return candidates.map((candidate) => ({
    entity_id: Number(candidate.record.entity_id),
    entity_name: candidate.record.entity_name ?? '',
    confidence: candidate.confidence,
    match_tier: candidate.match_tier,
    matched_fields: candidate.matched_fields.map((field) => ({
      field: field.field,
      strategy: field.strategy,
      score: field.score,
    })),
  }));
}

/** Run the deterministic matcher; returns the internal entity-profile response. */
export async function resolveDirectory(
  db: QueryExecutor,
  input: DirectoryResolveInput,
  tenantId: number,
  profile: SearchProfile,
): Promise<DirectoryResolveResponse> {
  const relatedTenantIds = await findRelatedTenantIds(db, tenantId);
  const hints = buildSignalHints(input.signals);

  if (input.confirm_match?.entity_id) {
    await assertEntityExistsForTenant(db, tenantId, input.confirm_match.entity_id, relatedTenantIds);
    const entity = await finalizeMatchedEntity(
      db,
      tenantId,
      input.confirm_match.entity_id,
      input.signals,
      relatedTenantIds,
    );

    return {
      resolution: 'matched',
      confidence: 100,
      entity,
      candidates: [],
      reasoning: 'Entity explicitly confirmed.',
    };
  }

  const hasStrongSignal =
    !!input.signals.entity_name || !!input.signals.tax_id || !!input.signals.eori;
  if (!hasStrongSignal) {
    return {
      resolution: 'not_found',
      confidence: null,
      entity: null,
      candidates: [],
      reasoning:
        'No strong signals provided (entity_name, tax_id, or eori). Cannot perform meaningful matching with only contextual signals.',
      hints,
    };
  }

  if (input.signals.tax_id || input.signals.eori) {
    const normalizedTaxId = input.signals.tax_id ? normalizeIdentifier(input.signals.tax_id) : '';
    const normalizedEori = input.signals.eori ? normalizeIdentifier(input.signals.eori) : '';
    const identifierMatches = await fetchByIdentifier(
      db,
      normalizedTaxId,
      normalizedEori,
      relatedTenantIds,
    );

    if (identifierMatches.length === 1) {
      const entity = await finalizeMatchedEntity(
        db,
        tenantId,
        Number(identifierMatches[0].entity_id),
        input.signals,
        relatedTenantIds,
      );
      return {
        resolution: 'matched',
        confidence: 100,
        entity,
        candidates: [],
        reasoning: 'Exact identifier match found within tenant group.',
      };
    }

    if (identifierMatches.length > 1) {
      const nameWinner = pickUniqueIdentifierMatchByEntityName(
        identifierMatches,
        input.signals,
        profile,
      );
      if (nameWinner) {
        const entity = await finalizeMatchedEntity(
          db,
          tenantId,
          Number(nameWinner.entity_id),
          input.signals,
          relatedTenantIds,
        );
        return {
          resolution: 'matched',
          confidence: clampScore(nameWinner.nameScore),
          entity,
          candidates: [],
          reasoning: `Exact identifier match; disambiguated by entity_name (name alignment score ${nameWinner.nameScore}).`,
          ...(hints.length > 0 ? { hints } : {}),
        };
      }

      return {
        resolution: 'ambiguous',
        confidence: null,
        entity: null,
        candidates: identifierMatches.map((m) => ({
          entity_id: Number(m.entity_id),
          entity_name: m.entity_name,
          confidence: 100,
          match_tier: 'exact' as const,
          matched_fields: [
            {
              field: normalizedTaxId ? 'tax_id' : 'eori',
              strategy: 'exact_identifier',
              score: 100,
            },
          ],
        })),
        reasoning:
          'Multiple entities share the same identifier within tenant group. Provide entity_name or use confirm_match when names do not separate a clear winner.',
        ...(hints.length > 0 ? { hints } : {}),
      };
    }
  }

  const candidates = await fetchResolutionCandidates(
    db,
    tenantId,
    input.signals,
    profile,
    relatedTenantIds,
  );
  const outcome = await scoreCandidates(tenantId, profile, input.signals, candidates);

  if (outcome.resolution === 'matched' && outcome.candidates[0]) {
    const winner = outcome.candidates[0];
    const entity = await finalizeMatchedEntity(
      db,
      tenantId,
      Number(winner.record.entity_id),
      input.signals,
      relatedTenantIds,
    );

    return {
      resolution: 'matched',
      confidence: outcome.confidence,
      entity,
      candidates: [],
      reasoning: outcome.reasoning,
      ...(hints.length > 0 ? { hints } : {}),
    };
  }

  if (outcome.resolution === 'ambiguous') {
    return {
      resolution: 'ambiguous',
      confidence: null,
      entity: null,
      candidates: mapResolutionCandidates(outcome.candidates),
      reasoning: outcome.reasoning,
      ...(hints.length > 0 ? { hints } : {}),
    };
  }

  return {
    resolution: 'not_found',
    confidence: null,
    entity: null,
    candidates: [],
    reasoning: outcome.reasoning,
    hints,
  };
}
