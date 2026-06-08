/**
 * Flat resolution contract (HANDOFF-resolve-entity §4.2).
 *
 * Decision (grill 2026-06-07, output_contract=B): the capability emits this flat contract via a
 * thin mapping layer over the unchanged kernel. `status` is the coarse outcome; `resolution_status`
 * is the fine-grained value the provision gate consumes.
 */

export type EntityResolutionStatus = 'resolved' | 'ambiguous' | 'not_found';

export type ResolutionStatus =
  | 'resolved'
  | 'ambiguous_entity'
  | 'ambiguous_address'
  | 'address_not_for_tenant'
  | 'not_found';

export type MatchTier = 'exact' | 'strong' | 'probable' | 'weak';

export interface ResolutionCandidate {
  entity_id: number;
  entity_address_id: number | null;
  name: string;
  country: string | null;
  city: string | null;
  tenant: number | null;
  active: boolean;
  confidence: number;
  match_tier: MatchTier;
}

/** The single signal bundle the resolver consumes (harvested at extraction time). */
export interface ResolutionSignals {
  entity_name?: string | null;
  tax_id?: string | null;
  eori?: string | null;
  country_code?: string | null;
  city?: string | null;
  address_line_1?: string | null;
  /** All issuer-name candidates from extraction (misleading-PDF case). */
  candidate_names?: string[];
}

export interface ResolveEntityInput {
  /** Directorio tenant id = cd_identityTenant = cd_identityDatosRFC (processing office). */
  tenantId: number;
  signals: ResolutionSignals;
  /** Manual confirmation path (human selected an entity). */
  confirm_match?: { entity_id: number } | null;
}

export interface ResolveEntityResult {
  status: EntityResolutionStatus;
  entity_id: number | null;
  entity_address_id: number | null;
  resolution_status: ResolutionStatus;
  confidence: number | null;
  candidates: ResolutionCandidate[];
  reason: string;
  /** Input-completeness guidance, UI-facing — NOT agent steering. */
  hints: string[];
  /** Whether a learned-alias DB hit drove the decision (observability). */
  alias_hit: boolean;
}
