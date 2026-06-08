/**
 * Directorio DB queries (ported verbatim from journeys resolve-directory.helper.ts).
 *
 * SQL is unchanged — this is the proven matcher's data layer. Only the binding changed: each
 * function takes the injected `QueryExecutor` (a Kysely instance) instead of a `Kysely<DB>` welded
 * to the journeys generated schema. Raw `sql<T>` queries don't need the typed schema.
 */

import { sql } from 'kysely';

import type { SearchProfile } from '../core/config';
import type { QueryExecutor } from '../core/executor';
import { ResolutionInfraError } from '../core/errors';
import {
  getTrigrams,
  normalizeCity,
  normalizeEntityName,
  normalizeIdentifier,
} from './normalize';
import type {
  DirectoryEntityAddress,
  DirectoryResolveCandidate,
  ResolveSignals,
} from './types';

/** Entity exists in the directorio but not for the processing tenant group. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

function sqlIntList(ids: number[]) {
  return sql.join(ids.map((id) => sql`${id}`));
}

function serializeRow<T extends object>(row: T): T {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]),
  ) as T;
}

/** Wrap raw DB execution so infra failures surface as a typed error (failure_semantics=A). */
async function exec<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new ResolutionInfraError(`Directorio query failed (${label})`, error);
  }
}

export async function findRelatedTenantIds(
  db: QueryExecutor,
  tenantId: number,
): Promise<number[]> {
  const result = await exec('findRelatedTenantIds', () =>
    sql<{ tenant_id: number }>`
      WITH TenantSede AS (
        SELECT d.cd_identityDirectorio
        FROM TCSch_DatosRFC d WITH (NOLOCK)
        WHERE d.cd_identityDatosRFC = ${tenantId}
      ),
      GroupMembers AS (
        SELECT dr.cd_identityDatosRFC AS tenant_id
        FROM TCSch_Directorio d WITH (NOLOCK)
        INNER JOIN TCSch_DatosRFC dr WITH (NOLOCK)
          ON dr.cd_identityDirectorio = d.cd_identityDirectorio
        WHERE (d.cd_identityDirectorio = (SELECT cd_identityDirectorio FROM TenantSede)
               OR d.cd_identityDirectorioSede = (SELECT cd_identityDirectorio FROM TenantSede))
          AND d.st_estatus = 'A'
      )
      SELECT DISTINCT tenant_id
      FROM GroupMembers
    `.execute(db),
  );

  const ids = result.rows.map((r) => r.tenant_id);
  if (!ids.includes(tenantId)) {
    ids.push(tenantId);
  }
  return ids;
}

export async function assertEntityExistsForTenant(
  db: QueryExecutor,
  tenantId: number,
  entityId: number,
  relatedTenantIds?: number[],
): Promise<void> {
  const tenantIds = relatedTenantIds ?? (await findRelatedTenantIds(db, tenantId));

  const entityResult = await exec('assertEntityExistsForTenant', () =>
    sql<{ entity_id: number }>`
      SELECT TOP 1 dir.cd_identityDirectorio AS entity_id
      FROM TCSch_Directorio dir WITH (NOLOCK)
      WHERE dir.st_estatus = 'A'
        AND dir.cd_identityDirectorio = ${entityId}
        AND (
          dir.cd_identityTenant IN (${sqlIntList(tenantIds)})
          OR dir.cd_identityTenant IS NULL
          OR EXISTS (
            SELECT 1
            FROM TCSch_DirectorioDireccion dd WITH (NOLOCK)
            WHERE dd.cd_identityDirectorio = dir.cd_identityDirectorio
              AND dd.cd_identityTenant IN (${sqlIntList(tenantIds)})
              AND dd.st_estatus = 'A'
          )
          OR EXISTS (
            SELECT 1
            FROM TCSch_DirectorioTaxId tx WITH (NOLOCK)
            WHERE tx.cd_identityDirectorio = dir.cd_identityDirectorio
              AND tx.cd_identityTenant IN (${sqlIntList(tenantIds)})
              AND tx.st_estatus = 'A'
          )
        )
    `.execute(db),
  );

  if (!entityResult.rows[0]?.entity_id) {
    throw new NotFoundError(`Entity ${entityId} was not found for tenant ${tenantId}`);
  }
}

export async function fetchByIdentifier(
  db: QueryExecutor,
  normalizedTaxId: string,
  normalizedEori: string,
  relatedTenantIds: number[],
): Promise<Array<{ entity_id: number; entity_name: string }>> {
  if (!normalizedTaxId && !normalizedEori) return [];

  const result = await exec('fetchByIdentifier', () =>
    sql<{ entity_id: number; entity_name: string }>`
      SELECT DISTINCT
        dir.cd_identityDirectorio AS entity_id,
        dir.nb_nombreDirectorio AS entity_name
      FROM TCSch_DirectorioTaxId tx WITH (NOLOCK)
      INNER JOIN TCSch_Directorio dir WITH (NOLOCK)
        ON dir.cd_identityDirectorio = tx.cd_identityDirectorio
        AND dir.st_estatus = 'A'
      WHERE tx.st_estatus = 'A'
        AND tx.cd_identityTenant IN (${sqlIntList(relatedTenantIds)})
        AND (
          ${normalizedTaxId ? sql`UPPER(REPLACE(REPLACE(REPLACE(ISNULL(tx.tx_taxId, ''), '-', ''), '.', ''), ' ', '')) = ${normalizedTaxId}` : sql`1 = 0`}
          OR ${normalizedEori ? sql`UPPER(REPLACE(REPLACE(REPLACE(ISNULL(tx.tx_EORI, ''), '-', ''), '.', ''), ' ', '')) = ${normalizedEori}` : sql`1 = 0`}
        )
    `.execute(db),
  );

  return result.rows.map((row) => serializeRow(row));
}

export async function fetchResolutionCandidates(
  db: QueryExecutor,
  tenantId: number,
  input: ResolveSignals,
  profile: SearchProfile,
  relatedTenantIds?: number[],
): Promise<DirectoryResolveCandidate[]> {
  const tenantIds = relatedTenantIds ?? [tenantId];
  const normalizedName = input.entity_name
    ? normalizeEntityName(input.entity_name, profile.legalSuffixes)
    : '';
  const normalizedTaxId = input.tax_id ? normalizeIdentifier(input.tax_id) : '';
  const normalizedEori = input.eori ? normalizeIdentifier(input.eori) : '';
  const rawNameUpper = input.entity_name?.trim().toUpperCase() ?? '';
  const normalizedCity = input.city ? normalizeCity(input.city) : '';
  let trigramConditions: ReturnType<typeof sql> | null = null;

  if (normalizedName) {
    const words = normalizedName
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    const perWordTrigrams = words.flatMap((word) => getTrigrams(word)).filter(Boolean);
    if (perWordTrigrams.length > 0) {
      const uniquePerWordTrigrams = [...new Set(perWordTrigrams)];
      const selectedTrigrams =
        uniquePerWordTrigrams.length <= 6
          ? uniquePerWordTrigrams
          : Array.from({ length: 6 }, (_, idx) => {
              const position = Math.round((idx * (uniquePerWordTrigrams.length - 1)) / 5);
              return uniquePerWordTrigrams[position];
            });
      const uniqueTrigrams = [...new Set(selectedTrigrams)];
      trigramConditions = sql`(${sql.join(
        uniqueTrigrams.map(
          (trigram) => sql`LOWER(dir.nb_nombreDirectorio) LIKE ${'%' + trigram + '%'}`,
        ),
        sql` OR `,
      )})`;
    }
  }

  if (!normalizedTaxId && !normalizedEori && !trigramConditions) {
    return [];
  }

  const candidatesResult = await exec('fetchResolutionCandidates', () =>
    sql<DirectoryResolveCandidate>`
      SELECT DISTINCT TOP 200
        dir.cd_identityDirectorio AS entity_id,
        dir.nb_nombreDirectorio AS entity_name,
        tx.tx_taxId AS tax_id,
        tx.tx_EORI AS eori,
        ps.tx_acronimoPais AS country_code,
        dd.tx_municipio AS city,
        dir.cd_identityTenant AS owner_tenant_id,
        CASE
          WHEN ${normalizedTaxId ? sql`UPPER(REPLACE(REPLACE(REPLACE(ISNULL(tx.tx_taxId, ''), '-', ''), '.', ''), ' ', '')) = ${normalizedTaxId}` : sql`1 = 0`} THEN 0
          WHEN ${normalizedEori ? sql`UPPER(REPLACE(REPLACE(REPLACE(ISNULL(tx.tx_EORI, ''), '-', ''), '.', ''), ' ', '')) = ${normalizedEori}` : sql`1 = 0`} THEN 0
          ELSE 1
        END AS _id_priority,
        CASE WHEN dir.cd_identityTenant = ${tenantId} THEN 0 ELSE 1 END AS _tenant_priority,
        CASE WHEN ${rawNameUpper ? sql`UPPER(dir.nb_nombreDirectorio) = ${rawNameUpper}` : sql`1 = 0`} THEN 0 ELSE 1 END AS _name_exact_priority,
        CASE WHEN ${rawNameUpper ? sql`UPPER(dir.nb_nombreDirectorio) LIKE ${rawNameUpper + '%'}` : sql`1 = 0`} THEN 0 ELSE 1 END AS _name_prefix_priority,
        CASE WHEN ${normalizedCity ? sql`UPPER(ISNULL(dd.tx_municipio, '')) = ${normalizedCity}` : sql`1 = 0`} THEN 0 ELSE 1 END AS _city_priority
      FROM TCSch_Directorio dir WITH (NOLOCK)
      LEFT JOIN TCSch_DirectorioTaxId tx WITH (NOLOCK)
        ON tx.cd_identityDirectorio = dir.cd_identityDirectorio
        AND tx.st_estatus = 'A'
        AND tx.cd_identityTenant IN (${sqlIntList(tenantIds)})
      LEFT JOIN TCSch_DirectorioDireccion dd WITH (NOLOCK)
        ON dd.cd_identityDirectorio = dir.cd_identityDirectorio
        AND dd.st_estatus = 'A'
        AND dd.cd_identityTenant IN (${sqlIntList(tenantIds)})
      LEFT JOIN TCSch_Pais ps WITH (NOLOCK)
        ON ps.cd_identityPais = dd.cd_identityPais
      WHERE dir.st_estatus = 'A'
        AND (
          ${
            normalizedTaxId
              ? sql`UPPER(REPLACE(REPLACE(REPLACE(ISNULL(tx.tx_taxId, ''), '-', ''), '.', ''), ' ', '')) = ${normalizedTaxId}`
              : sql`1 = 0`
          }
          OR ${
            normalizedEori
              ? sql`UPPER(REPLACE(REPLACE(REPLACE(ISNULL(tx.tx_EORI, ''), '-', ''), '.', ''), ' ', '')) = ${normalizedEori}`
              : sql`1 = 0`
          }
          OR ${trigramConditions ?? sql`1 = 0`}
          OR ${rawNameUpper ? sql`UPPER(dir.nb_nombreDirectorio) = ${rawNameUpper}` : sql`1 = 0`}
        )
      ORDER BY _name_exact_priority, _name_prefix_priority, _id_priority, _city_priority, _tenant_priority, dir.cd_identityDirectorio DESC
    `.execute(db),
  );

  return candidatesResult.rows.map((row) => serializeRow(row));
}

function deriveEntityRole(
  ir: string | null,
  ii: string | null,
): 'client' | 'supplier' | 'client_and_supplier' | 'unknown' {
  const s = ir === 'S';
  const c = ii === 'S';
  return s && c ? 'client_and_supplier' : s ? 'supplier' : c ? 'client' : 'unknown';
}

export interface EntityProfileRows {
  entity: { entity_id: number; entity_name: string } | undefined;
  addresses: DirectoryEntityAddress[];
  taxInfo: {
    entity_tax_id: number;
    tax_id: string | null;
    tax_id_2: string | null;
    EORI: string | null;
    EORI_branch: string | null;
    entity_role: 'client' | 'supplier' | 'client_and_supplier' | 'unknown';
  } | null;
}

export async function fetchEntityProfileRows(
  db: QueryExecutor,
  entityId: number,
  tenantId: number,
): Promise<EntityProfileRows> {
  const [entityResult, addressesResult, taxResult] = await exec('fetchEntityProfileRows', () =>
    Promise.all([
      sql<{ entity_id: number; entity_name: string }>`
        SELECT TOP 1
          dir.cd_identityDirectorio AS entity_id,
          dir.nb_nombreDirectorio AS entity_name
        FROM TCSch_Directorio dir WITH (NOLOCK)
        WHERE dir.st_estatus = 'A'
          AND dir.cd_identityDirectorio = ${entityId}
      `.execute(db),
      sql<DirectoryEntityAddress>`
        SELECT
          dd.cd_identityDirectorioDireccion AS entity_address_id,
          dd.tx_calle AS street,
          dd.tx_numeroExterior AS exterior_number,
          dd.tx_numeroInterior AS interior_number,
          dd.tx_colonia AS neighborhood,
          dd.tx_municipio AS city,
          dd.tx_codigoPostal AS postcode,
          dd.tx_estado AS state,
          dd.tx_direccionDirectorio AS full_address,
          ps.tx_acronimoPais AS country_code
        FROM TCSch_DirectorioDireccion dd WITH (NOLOCK)
        LEFT JOIN TCSch_Pais ps WITH (NOLOCK)
          ON ps.cd_identityPais = dd.cd_identityPais
        WHERE dd.st_estatus = 'A'
          AND dd.cd_identityTenant = ${tenantId}
          AND dd.cd_identityDirectorio = ${entityId}
        ORDER BY dd.cd_identityDirectorioDireccion DESC
      `.execute(db),
      sql<{
        entity_tax_id: number;
        tax_id: string | null;
        tax_id_2: string | null;
        EORI: string | null;
        EORI_branch: string | null;
        invoices_received: string | null;
        invoices_issued: string | null;
      }>`
        SELECT TOP 1
          tx.cd_identityDirectorioTaxId AS entity_tax_id,
          tx.tx_taxId AS tax_id,
          tx.tx_taxId2 AS tax_id_2,
          tx.tx_EORI AS EORI,
          tx.tx_EORIBranch AS EORI_branch,
          tx.st_facturasRecibidas AS invoices_received,
          tx.st_facturasEmitidas AS invoices_issued
        FROM TCSch_DirectorioTaxId tx WITH (NOLOCK)
        WHERE tx.st_estatus = 'A'
          AND tx.cd_identityTenant = ${tenantId}
          AND tx.cd_identityDirectorio = ${entityId}
        ORDER BY tx.cd_identityDirectorioTaxId DESC
      `.execute(db),
    ]),
  );

  const entity = entityResult.rows[0];
  const taxRow = taxResult.rows[0];
  const taxInfo = taxRow
    ? {
        entity_tax_id: Number(taxRow.entity_tax_id),
        tax_id: taxRow.tax_id,
        tax_id_2: taxRow.tax_id_2,
        EORI: taxRow.EORI,
        EORI_branch: taxRow.EORI_branch,
        entity_role: deriveEntityRole(taxRow.invoices_received, taxRow.invoices_issued),
      }
    : null;

  return {
    entity: entity ? { entity_id: Number(entity.entity_id), entity_name: entity.entity_name } : undefined,
    addresses: addressesResult.rows.map((address) => ({
      ...address,
      entity_address_id: Number(address.entity_address_id),
    })),
    taxInfo,
  };
}
