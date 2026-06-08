/** Internal engine types (ported from journeys resolve-directory.helper.ts). */

import type { ResolutionSignals } from '../core/result';

export type InternalMatchTier = 'exact' | 'strong' | 'probable' | 'weak';
export type InternalResolution = 'matched' | 'ambiguous' | 'not_found';

/** The matcher consumes the single-name signal set (candidate_names handled one level up). */
export type ResolveSignals = Omit<ResolutionSignals, 'candidate_names'>;

export type CandidateRecord = {
  entity_id: number;
  entity_name?: string | null;
  tax_id?: string | null;
  eori?: string | null;
  country_code?: string | null;
  city?: string | null;
  owner_tenant_id?: number | null;
};

export type MatchDetail = { field: string; strategy: string; score: number };

export type ScoredCandidate = {
  record: CandidateRecord;
  confidence: number;
  match_tier: InternalMatchTier;
  matched_fields: MatchDetail[];
  reasoning: string;
};

export type ResolutionOutcome = {
  resolution: InternalResolution;
  confidence: number | null;
  entity: null;
  candidates: ScoredCandidate[];
  reasoning: string;
};

export type NormalizedIntent = {
  entityName: string;
  taxId: string;
  eori: string;
  countryCode: string;
  city: string;
};

export interface DirectoryEntityAddress {
  entity_address_id: number;
  street: string | null;
  exterior_number: string | null;
  interior_number: string | null;
  neighborhood: string | null;
  city: string | null;
  postcode: string | null;
  state: string | null;
  full_address: string | null;
  country_code: string | null;
}

export type EntityRole = 'client' | 'supplier' | 'client_and_supplier' | 'unknown';

export interface DirectoryEntityTaxInfo {
  entity_tax_id: number;
  tax_id: string | null;
  tax_id_2: string | null;
  EORI: string | null;
  EORI_branch: string | null;
  entity_role: EntityRole;
}

export interface DirectoryEntityProfile {
  entity_id: number;
  entity_name: string;
  addresses: DirectoryEntityAddress[];
  tax_info: DirectoryEntityTaxInfo | null;
  owner_tenant_id: number | null;
  primary_keys: {
    cd_identityDirectorio: number;
    cd_identityTenant: number;
    cd_identityDirectorioDireccion: number[];
    cd_identityDirectorioTaxId: number | null;
  };
}

export interface DirectoryResolveResponse {
  resolution: InternalResolution;
  confidence: number | null;
  entity: DirectoryEntityProfile | null;
  candidates: Array<{
    entity_id: number;
    entity_name: string;
    confidence: number;
    match_tier: InternalMatchTier;
    matched_fields: MatchDetail[];
  }>;
  reasoning: string;
  hints?: string[];
}

export interface DirectoryResolveCandidate extends CandidateRecord {
  entity_name: string;
  tax_id: string | null;
  eori: string | null;
  country_code: string | null;
  city: string | null;
  owner_tenant_id: number | null;
}
