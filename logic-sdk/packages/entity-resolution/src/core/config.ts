/**
 * Scoring config / tunables.
 *
 * Decision (grill 2026-06-07, config=A): hardcoded default profile (current journeys weights /
 * thresholds), optionally overridable via an injected param. No DB-resident tunable reads in the
 * prototype — those become a build-phase swap behind this same typed boundary.
 */

import type { ResolutionSignals } from './result';

export type SearchProfile = {
  domain: string;
  legalSuffixes: string[];
  fields: Array<{ name: keyof ResolutionSignals; weight: number }>;
  thresholds: { exact: number; strong: number; probable: number; minimum: number };
  corroborationBonusPerSignal: number;
  maxCorroborationBonus: number;
};

export const LEGAL_SUFFIXES = [
  'S.A. DE C.V.',
  'SA DE CV',
  'S. DE R.L. DE C.V.',
  'S.A.S.',
  'S.A.',
  'GMBH',
  'GMBH & CO KG',
  'GMBH & CO. KG',
  'AG',
  'A/S',
  'B.V.',
  'N.V.',
  'OY',
  'AB',
  'LLC',
  'LTD',
  'LIMITED',
  'INC',
  'INCORPORATED',
  'CORP',
  'CORPORATION',
  'CO',
  'PLC',
  'PTY LTD',
  'S.R.L.',
  'SRL',
  'S.L.',
  'SAS',
  'SARL',
  'KK',
  'PTE LTD',
];

export const DEFAULT_DIRECTORY_PROFILE: SearchProfile = {
  domain: 'directory',
  legalSuffixes: [...LEGAL_SUFFIXES],
  fields: [
    { name: 'tax_id', weight: 40 },
    { name: 'eori', weight: 35 },
    { name: 'entity_name', weight: 20 },
    { name: 'country_code', weight: 3 },
    { name: 'city', weight: 2 },
  ],
  thresholds: {
    exact: 95,
    strong: 80,
    probable: 65,
    minimum: 50,
  },
  corroborationBonusPerSignal: 5,
  maxCorroborationBonus: 15,
};

export interface ResolveConfig {
  profile: SearchProfile;
  /**
   * Read the learned-alias store (directorio_resolved_alias). Default true.
   * Prototype: read-only DB lookup against a hand-seeded row (proves TC-10/AC-11).
   */
  useLearnedAlias: boolean;
}

export const DEFAULT_CONFIG: ResolveConfig = {
  profile: DEFAULT_DIRECTORY_PROFILE,
  useLearnedAlias: true,
};

export function resolveConfig(override?: Partial<ResolveConfig>): ResolveConfig {
  return {
    profile: override?.profile ?? DEFAULT_CONFIG.profile,
    useLearnedAlias: override?.useLearnedAlias ?? DEFAULT_CONFIG.useLearnedAlias,
  };
}
