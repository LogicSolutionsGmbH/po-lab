/**
 * Deterministic scenario suite (HANDOFF-resolve-entity §10, TC-1…TC-12).
 *
 * Decision (grill 2026-06-07, validation_harness=C): hybrid — most cases run read-only against a
 * real dev tenant; TC-10 (alias) + any ambiguity rows live data can't guarantee must be seeded.
 *
 * ⚠️ The signal values below are PLACEHOLDERS. Fill them with real vendor data for the chosen dev
 * tenant (and seed the supporting rows for TC-4/5/8/10). `expected` is the resolution_status the
 * resolver must return for that tenant; pin it once you know the data.
 */

import type { ResolutionSignals, ResolutionStatus } from '../core/result';

export interface Scenario {
  id: string;
  description: string;
  signals: ResolutionSignals;
  confirm_match?: { entity_id: number } | null;
  expected: ResolutionStatus;
  gate: 'open' | 'blocked' | 'n/a';
  /** Skip = not an in-process resolver call (worker-gate or infra-simulation concern). */
  skip?: boolean;
  note?: string;
  /** Needs seeded rows beyond what live data guarantees. */
  needsSeed?: boolean;
}

const PH = '__PLACEHOLDER__';

export const SCENARIOS: Scenario[] = [
  {
    id: 'TC-1',
    description: 'Clean vendor, one entity + address',
    signals: { entity_name: PH, tax_id: PH, country_code: PH },
    expected: 'resolved',
    gate: 'open',
  },
  {
    id: 'TC-2',
    description: 'Name only, unique match w/ country',
    signals: { entity_name: PH, country_code: PH },
    expected: 'resolved',
    gate: 'open',
  },
  {
    id: 'TC-3',
    description: 'Two "Logic Solutions" entity ids',
    signals: { entity_name: PH /* e.g. "Logic Solutions" */ },
    expected: 'ambiguous_entity',
    gate: 'blocked',
  },
  {
    id: 'TC-4',
    description: 'MSC SA vs S A, same address',
    signals: { entity_name: PH /* e.g. "MSC SA" */ },
    expected: 'ambiguous_entity',
    gate: 'blocked',
    needsSeed: true,
  },
  {
    id: 'TC-5',
    description: 'Logic Solutions, Morocco tenant, no MA address',
    signals: { entity_name: PH, country_code: 'MA' },
    expected: 'address_not_for_tenant',
    gate: 'blocked',
    needsSeed: true,
  },
  {
    id: 'TC-6',
    description: 'Unknown vendor',
    signals: { entity_name: 'ZZZ NONEXISTENT VENDOR 99999', tax_id: 'XX0000000000' },
    expected: 'not_found',
    gate: 'blocked',
  },
  {
    id: 'TC-7',
    description: 'One entity, 2 addresses, city narrows',
    signals: { entity_name: PH, city: PH /* matching one address */ },
    expected: 'resolved',
    gate: 'open',
    needsSeed: true,
  },
  {
    id: 'TC-8',
    description: 'One entity, 2 addresses, cannot narrow',
    signals: { entity_name: PH /* no city/country to narrow */ },
    expected: 'ambiguous_address',
    gate: 'blocked',
    needsSeed: true,
  },
  {
    id: 'TC-9',
    description: 'Commercial-invoice tag (no resolution / no Participantes)',
    signals: {},
    expected: 'not_found',
    gate: 'n/a',
    skip: true,
    note: 'Worker-gate concern (non-AP tags do not trigger resolution); not an SDK call.',
  },
  {
    id: 'TC-10',
    description: 'Prior confirmed alias for vendor+tenant',
    signals: { entity_name: PH, tax_id: PH /* matching a seeded directorio_resolved_alias row */ },
    expected: 'resolved',
    gate: 'open',
    needsSeed: true,
    note: 'Seed a directorio_resolved_alias row for this tenant + normalized signal.',
  },
  {
    id: 'TC-11',
    description: 'Misleading PDF; correct issuer among candidate_names',
    signals: {
      entity_name: PH /* the wrong/large-print name */,
      candidate_names: [PH /* wrong */, PH /* correct small-print issuer */],
    },
    expected: 'resolved',
    gate: 'open',
  },
  {
    id: 'TC-12',
    description: 'Resolver infrastructure failure',
    signals: { entity_name: PH },
    expected: 'not_found',
    gate: 'blocked',
    skip: true,
    note: 'In-process analog of "endpoint down": ResolutionInfraError → host marks unresolved + blocks. Exercised separately.',
  },
];
