/**
 * Weighted multi-signal scoring engine (ported from journeys resolve-directory.helper.ts).
 *
 * Change vs source (grill 2026-06-07, alias_path=C / api_shape=A): the in-memory `AliasCache`,
 * `aliasHit`, and `memorizeSignals` are REMOVED. They were per-process + TTL-evicted (non-
 * deterministic, fragmenting across hosts) — wrong for a multi-host in-process SDK. The learned
 * alias is now a deterministic read-only DB lookup handled one level up (see ../alias.ts), and the
 * engine itself is pure (no retained state, no module singletons).
 */

import * as fuzzball from 'fuzzball';

import type { SearchProfile } from '../core/config';
import {
  clampScore,
  normalizeCity,
  normalizeEntityName,
  normalizeIdentifier,
  tokenize,
} from './normalize';
import type {
  CandidateRecord,
  InternalMatchTier,
  MatchDetail,
  NormalizedIntent,
  ResolutionOutcome,
  ResolveSignals,
  ScoredCandidate,
} from './types';

type DoubleMetaphoneFn = (value: string) => [string, string];

let cachedDoubleMetaphone: DoubleMetaphoneFn | null = null;
let phoneticImportAttempted = false;

async function getDoubleMetaphone(): Promise<DoubleMetaphoneFn | null> {
  if (cachedDoubleMetaphone) return cachedDoubleMetaphone;
  if (phoneticImportAttempted) return null;
  phoneticImportAttempted = true;
  try {
    cachedDoubleMetaphone = (await import('double-metaphone')).doubleMetaphone;
    return cachedDoubleMetaphone;
  } catch {
    return null;
  }
}

function toTier(confidence: number, profile: SearchProfile): InternalMatchTier {
  if (confidence >= profile.thresholds.exact) return 'exact';
  if (confidence >= profile.thresholds.strong) return 'strong';
  if (confidence >= profile.thresholds.probable) return 'probable';
  return 'weak';
}

function buildReasoning(details: MatchDetail[]): string {
  if (details.length === 0) {
    return 'No matching strategies produced a score above zero.';
  }
  return details
    .sort((a, b) => b.score - a.score)
    .map((detail) => `${detail.field}:${detail.strategy}(${detail.score})`)
    .join('; ');
}

function fieldWeight(profile: SearchProfile, fieldName: keyof ResolveSignals): number {
  return profile.fields.find((field) => field.name === fieldName)?.weight ?? 0;
}

type ScoredCandidateWithRankMeta = ScoredCandidate & {
  _matchedWeight: number;
  _rawScore: number;
};

function phoneticScore(
  queryPhonetics: Array<[string, string]>,
  candidate: string,
  doubleMetaphone: DoubleMetaphoneFn,
): number {
  if (!candidate || queryPhonetics.length === 0) return 0;

  const candidateTokens = tokenize(candidate).slice(0, 6);
  if (candidateTokens.length === 0) return 0;

  let matchedTokens = 0;
  for (const [qPrimary, qSecondary] of queryPhonetics) {
    const hasMatch = candidateTokens.some((candidateToken) => {
      const [cPrimary, cSecondary] = doubleMetaphone(candidateToken);
      return (
        (qPrimary && (qPrimary === cPrimary || qPrimary === cSecondary)) ||
        (qSecondary && (qSecondary === cPrimary || qSecondary === cSecondary))
      );
    });
    if (hasMatch) {
      matchedTokens += 1;
    }
  }

  return clampScore((matchedTokens / queryPhonetics.length) * 85);
}

function normalizeIntent(intent: ResolveSignals, profile: SearchProfile): NormalizedIntent {
  return {
    entityName: intent.entity_name
      ? normalizeEntityName(intent.entity_name, profile.legalSuffixes)
      : '',
    taxId: intent.tax_id ? normalizeIdentifier(intent.tax_id) : '',
    eori: intent.eori ? normalizeIdentifier(intent.eori) : '',
    countryCode: intent.country_code ? normalizeIdentifier(intent.country_code) : '',
    city: intent.city ? normalizeCity(intent.city) : '',
  };
}

/** Pure, deterministic candidate scorer. No retained state. */
export async function scoreCandidates(
  tenantId: number,
  profile: SearchProfile,
  intent: ResolveSignals,
  candidates: CandidateRecord[],
): Promise<ResolutionOutcome> {
  const normalizedIntent = normalizeIntent(intent, profile);
  const queryTokens = tokenize(normalizedIntent.entityName);
  const queryTokenSet = new Set(queryTokens);
  const doubleMetaphone = normalizedIntent.entityName ? await getDoubleMetaphone() : null;
  const queryPhonetics =
    doubleMetaphone && queryTokens.length > 0
      ? queryTokens.slice(0, 3).map((token) => doubleMetaphone(token))
      : [];

  const scored: ScoredCandidateWithRankMeta[] = [];
  const corroborationBonus = profile.corroborationBonusPerSignal ?? 5;
  const maxCorroborationBonus = profile.maxCorroborationBonus ?? 15;

  for (const candidate of candidates) {
    const details: MatchDetail[] = [];
    const weightedScores: number[] = [];
    let weights = 0;
    let matchedSignals = 0;
    let hasPrimaryMatch = false;

    const candidateName = candidate.entity_name
      ? normalizeEntityName(candidate.entity_name, profile.legalSuffixes)
      : '';
    const candidateTaxId = candidate.tax_id ? normalizeIdentifier(candidate.tax_id) : '';
    const candidateEori = candidate.eori ? normalizeIdentifier(candidate.eori) : '';
    const candidateCountry = candidate.country_code
      ? normalizeIdentifier(candidate.country_code)
      : '';
    const candidateCity = candidate.city ? normalizeCity(candidate.city) : '';

    if (normalizedIntent.taxId) {
      const taxWeight = fieldWeight(profile, 'tax_id');
      const isExact = normalizedIntent.taxId === candidateTaxId;
      if (isExact) {
        details.push({ field: 'tax_id', strategy: 'exact_identifier', score: 100 });
        weightedScores.push(100 * taxWeight);
        weights += taxWeight;
        matchedSignals += 1;
        hasPrimaryMatch = true;
      }
    }

    if (normalizedIntent.eori) {
      const eoriWeight = fieldWeight(profile, 'eori');
      const isExact = normalizedIntent.eori === candidateEori;
      if (isExact) {
        details.push({ field: 'eori', strategy: 'exact_identifier', score: 100 });
        weightedScores.push(100 * eoriWeight);
        weights += eoriWeight;
        matchedSignals += 1;
        hasPrimaryMatch = true;
      }
    }

    if (normalizedIntent.entityName) {
      const nameWeight = fieldWeight(profile, 'entity_name');
      let nameScore = 0;
      const hasExactIdentifierMatch =
        (normalizedIntent.taxId && normalizedIntent.taxId === candidateTaxId) ||
        (normalizedIntent.eori && normalizedIntent.eori === candidateEori);

      if (candidateName && candidateName === normalizedIntent.entityName) {
        nameScore = 100;
        details.push({ field: 'entity_name', strategy: 'exact_name', score: nameScore });
      } else {
        const candidateTokens = tokenize(candidateName);
        const hasTokenOverlap =
          queryTokenSet.size > 0 && candidateTokens.some((token) => queryTokenSet.has(token));

        if (!hasTokenOverlap && !hasExactIdentifierMatch) {
          continue;
        }

        const containsAllTokens =
          queryTokens.length > 0 && queryTokens.every((token) => candidateTokens.includes(token));
        if (containsAllTokens) {
          nameScore = Math.max(nameScore, 95);
          details.push({ field: 'entity_name', strategy: 'token_containment', score: 95 });
        }

        if (candidateName) {
          const fuzzyScore = clampScore(
            fuzzball.token_set_ratio(candidateName, normalizedIntent.entityName),
          );
          if (fuzzyScore > 0) {
            nameScore = Math.max(nameScore, fuzzyScore);
            details.push({
              field: 'entity_name',
              strategy: 'token_set_fuzzy',
              score: fuzzyScore,
            });
          }

          if (
            nameScore < profile.thresholds.strong &&
            doubleMetaphone &&
            queryPhonetics.length > 0
          ) {
            const phonetic = phoneticScore(queryPhonetics, candidateName, doubleMetaphone);
            if (phonetic > 0) {
              nameScore = Math.max(nameScore, phonetic);
              details.push({ field: 'entity_name', strategy: 'phonetic', score: phonetic });
            }
          }
        }
      }

      if (nameScore > 0) {
        weightedScores.push(nameScore * nameWeight);
        weights += nameWeight;
        matchedSignals += 1;
        hasPrimaryMatch = true;
      }
    }

    if (normalizedIntent.countryCode) {
      const countryWeight = fieldWeight(profile, 'country_code');
      if (candidateCountry && normalizedIntent.countryCode === candidateCountry) {
        details.push({ field: 'country_code', strategy: 'exact_identifier', score: 100 });
        weightedScores.push(100 * countryWeight);
        weights += countryWeight;
        matchedSignals += 1;
      }
    }

    if (normalizedIntent.city) {
      const cityWeight = fieldWeight(profile, 'city');
      if (candidateCity && normalizedIntent.city === candidateCity) {
        details.push({ field: 'city', strategy: 'exact_identifier', score: 100 });
        weightedScores.push(100 * cityWeight);
        weights += cityWeight;
        matchedSignals += 1;
      }
    }

    if (weights === 0 || !hasPrimaryMatch) {
      continue;
    }

    const weightedAverage = weightedScores.reduce((sum, value) => sum + value, 0) / weights;
    const boost = Math.min(
      maxCorroborationBonus,
      Math.max(0, matchedSignals - 1) * corroborationBonus,
    );
    const rawScore = Math.round(weightedAverage + boost);

    if (rawScore < profile.thresholds.minimum) {
      continue;
    }

    if (boost > 0) {
      details.push({
        field: 'multi_signal',
        strategy: 'corroboration',
        score: clampScore(boost),
      });
    }

    scored.push({
      record: candidate,
      confidence: clampScore(rawScore),
      match_tier: toTier(clampScore(rawScore), profile),
      matched_fields: details,
      reasoning: buildReasoning(details),
      _matchedWeight: weights,
      _rawScore: rawScore,
    });
  }

  const dedupMap = new Map<number, (typeof scored)[number]>();
  for (const item of scored) {
    const entityId = Number(item.record.entity_id);
    const existing = dedupMap.get(entityId);
    if (!existing) {
      dedupMap.set(entityId, item);
    } else {
      const newRaw = item._rawScore;
      const existingRaw = existing._rawScore;
      if (newRaw > existingRaw) {
        dedupMap.set(entityId, item);
      } else if (newRaw === existingRaw) {
        const newOwned = Number(item.record.owner_tenant_id) === tenantId ? 1 : 0;
        const existingOwned = Number(existing.record.owner_tenant_id) === tenantId ? 1 : 0;
        if (newOwned > existingOwned) {
          dedupMap.set(entityId, item);
        }
      }
    }
  }
  const unique = Array.from(dedupMap.values());

  unique.sort((a, b) => {
    const rawDiff = b._rawScore - a._rawScore;
    if (rawDiff !== 0) return rawDiff;
    const weightDiff = b._matchedWeight - a._matchedWeight;
    if (weightDiff !== 0) return weightDiff;
    const aOwned = Number(a.record.owner_tenant_id) === tenantId ? 1 : 0;
    const bOwned = Number(b.record.owner_tenant_id) === tenantId ? 1 : 0;
    return bOwned - aOwned;
  });

  if (unique.length === 0) {
    return {
      resolution: 'not_found',
      confidence: null,
      entity: null,
      candidates: [],
      reasoning: 'All matching strategies exhausted with no candidate above minimum threshold.',
    };
  }

  const topRaw = unique[0]._rawScore;
  const secondRaw = unique[1] ? unique[1]._rawScore : 0;

  const uniquePublic = unique.map(({ _matchedWeight: _mw, _rawScore: _rs, ...rest }) => rest);

  const top = uniquePublic[0];
  const hasExactName = (item: ScoredCandidate) =>
    item.matched_fields.some((f) => f.strategy === 'exact_name' && f.score >= 100);
  const hasHighNameScore = (item: ScoredCandidate) =>
    item.matched_fields.some((f) => f.field === 'entity_name' && f.score >= 95);
  const isClearWinner =
    top.confidence > profile.thresholds.strong &&
    (!uniquePublic[1] ||
      topRaw - secondRaw >= 8 ||
      (topRaw >= 100 && secondRaw < 100) ||
      (hasExactName(top) &&
        !hasExactName(uniquePublic[1]) &&
        !hasHighNameScore(uniquePublic[1])));

  return {
    resolution: isClearWinner ? 'matched' : 'ambiguous',
    confidence: isClearWinner ? top.confidence : null,
    entity: null,
    candidates: uniquePublic.slice(0, 10),
    reasoning: isClearWinner
      ? `Clear winner found: ${top.reasoning}`
      : 'Multiple plausible candidates detected. Confirmation required.',
  };
}
