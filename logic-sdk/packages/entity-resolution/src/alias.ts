/**
 * Learned-alias store — deterministic READ path (HANDOFF-resolve-entity §6).
 *
 * Decision (grill 2026-06-07, alias_path=C): read-only against a hand-seeded
 * `directorio_resolved_alias` row to prove TC-10/AC-11. The in-memory cache from the journeys
 * kernel was dropped (wrong for a multi-host in-process SDK). Write-back (human-confirm) is a
 * build-phase concern (no UI in the prototype).
 *
 * PLACEHOLDER SCHEMA — the table/columns are the proposed shape; adjust to the real migration when
 * it lands. A confirmed alias short-circuits resolution to `resolved`.
 */

import { sql } from 'kysely';

import type { QueryExecutor } from './core/executor';
import type { Logger } from './core/logging';
import { normalizeEntityName, normalizeIdentifier } from './engine/normalize';
import type { SearchProfile } from './core/config';
import type { ResolutionSignals } from './core/result';

export interface LearnedAliasHit {
  entity_id: number;
  entity_address_id: number | null;
  matched_signal: string;
}

const ALIAS_TABLE = 'directorio_resolved_alias';

/**
 * Look up a confirmed alias for the strongest available signal (tax_id → eori → name).
 * Returns null on miss. Tolerant: if the table does not exist yet (unseeded dev DB), logs a warning
 * and returns null rather than failing resolution — the alias is a short-circuit, not a dependency.
 */
export async function readLearnedAlias(
  db: QueryExecutor,
  tenantId: number,
  signals: ResolutionSignals,
  profile: SearchProfile,
  logger: Logger,
): Promise<LearnedAliasHit | null> {
  const orderedSignals: string[] = [
    signals.tax_id ? normalizeIdentifier(signals.tax_id) : '',
    signals.eori ? normalizeIdentifier(signals.eori) : '',
    signals.entity_name ? normalizeEntityName(signals.entity_name, profile.legalSuffixes) : '',
  ].filter(Boolean);

  if (orderedSignals.length === 0) return null;

  for (const signal of orderedSignals) {
    try {
      const result = await sql<{
        entity_id: number;
        entity_address_id: number | null;
      }>`
        SELECT TOP 1
          a.entity_id AS entity_id,
          a.entity_address_id AS entity_address_id
        FROM ${sql.raw(ALIAS_TABLE)} a WITH (NOLOCK)
        WHERE a.tenant_id = ${tenantId}
          AND a.status = 'A'
          AND a.normalized_signal = ${signal}
        ORDER BY a.confirmed_at DESC
      `.execute(db);

      const row = result.rows[0];
      if (row?.entity_id) {
        return {
          entity_id: Number(row.entity_id),
          entity_address_id:
            row.entity_address_id === null ? null : Number(row.entity_address_id),
          matched_signal: signal,
        };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`[learned-alias] lookup skipped (${ALIAS_TABLE} unavailable?): ${msg}`);
      return null;
    }
  }

  return null;
}
