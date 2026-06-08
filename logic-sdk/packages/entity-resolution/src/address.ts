/**
 * Address selection + resolution_status derivation (HANDOFF-resolve-entity §4.2 / §5).
 *
 * NEW logic the journeys kernel did not have: pick a single entity_address_id from the matched
 * entity's tenant addresses, and derive the fine-grained resolution_status. Implemented as a thin
 * deterministic post-step over the kernel's entity profile (decision output_contract=B).
 *
 * Note: the kernel fetches addresses already scoped to the processing tenant
 * (DirectorioDireccion WHERE cd_identityTenant = tenantId), so an empty address list means the
 * entity exists but has no address for THIS tenant → address_not_for_tenant.
 */

import { normalizeCity } from './engine/normalize';
import type { DirectoryEntityAddress } from './engine/types';
import type { ResolutionSignals } from './core/result';

export type AddressResolution =
  | { entity_address_id: number; resolution_status: 'resolved' }
  | { entity_address_id: null; resolution_status: 'ambiguous_address' }
  | { entity_address_id: null; resolution_status: 'address_not_for_tenant' };

function addressSignalScore(addr: DirectoryEntityAddress, signals: ResolutionSignals): number {
  let score = 0;
  if (signals.city) {
    const nc = normalizeCity(signals.city);
    if (addr.city && normalizeCity(addr.city) === nc) score += 10;
  }
  if (signals.country_code) {
    const ng = signals.country_code.trim().toUpperCase();
    if (addr.country_code?.trim().toUpperCase() === ng) score += 1;
  }
  return score;
}

/** Select one address for the matched entity and derive the address-level status. */
export function selectAddress(
  addresses: DirectoryEntityAddress[],
  signals: ResolutionSignals,
): AddressResolution {
  if (addresses.length === 0) {
    return { entity_address_id: null, resolution_status: 'address_not_for_tenant' };
  }

  if (addresses.length === 1) {
    return {
      entity_address_id: Number(addresses[0].entity_address_id),
      resolution_status: 'resolved',
    };
  }

  const scored = addresses.map((addr) => ({
    id: Number(addr.entity_address_id),
    score: addressSignalScore(addr, signals),
  }));
  const maxScore = Math.max(...scored.map((s) => s.score));
  const topAddresses = scored.filter((s) => s.score === maxScore);

  // Multiple tenant addresses and no distinguishing signal (or a tie at the top) → can't narrow.
  if (maxScore === 0 || topAddresses.length > 1) {
    return { entity_address_id: null, resolution_status: 'ambiguous_address' };
  }

  return { entity_address_id: topAddresses[0].id, resolution_status: 'resolved' };
}
