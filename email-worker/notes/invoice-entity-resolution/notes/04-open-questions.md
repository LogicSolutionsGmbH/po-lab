# Open questions / to confirm

> **Resolved in PRD v1.0** (`PRD-resolve-entity.md`, 2026-06-06) — see "Decided" section below.

## Decided (2026-06-06)

| Topic | Decision |
|-------|----------|
| **Response contract** | 3 endpoint statuses: `exact_match \| ambiguous \| not_found` + `candidates[]` + `recommendations[]` + `reason` |
| **Incomplete representation** | `Factura Extraida Participantes.resolution_status` enum: `resolved`, `ambiguous_entity`, `ambiguous_address`, `address_not_for_tenant`, `not_found` |
| **Entity vs address ambiguity** | Derived from candidates: multiple entity_ids → entity ambiguity; one entity_id + multiple address_ids → address ambiguity |
| **Morocco / tenant case** | Own status: `address_not_for_tenant` (human creates tenant address) |
| **Max attempts / tools** | Max 3 attempts; tools = retry resolve-entity with more params, narrow by country/city/address, check previous resolutions; PDF re-fetch excluded |
| **Provision gate** | Both IDs present AND `resolution_status = resolved` |
| **Spec hand-off** | This PRD is the written spec for Krishna |

## Still open (post-v1)

- **UI surfacing:** exact copy, icons, and field-level indicators for incomplete resolution (Carlos + Ariana UX pass).
- **City / address at extraction:** confirm whether extraction reliably provides city and address line 1 for retry params, or name+country is the realistic default input.
- **Migration tooling:** scenario-2 cleanup mentions migrate-invoices-then-deactivate — one-off manual step vs tool to build (out of scope v1; manual for now).
- **Recommendation string i18n:** PRD defines English recommendation keys; localize in UI layer if needed.

## Backlinks
<!-- brain-nightly:start -->
- [[Notebooks/invoice-entity-resolution/00-index]] — "[[notes/04-open-questions]] — remaining post-v1 items"
<!-- brain-nightly:end -->
