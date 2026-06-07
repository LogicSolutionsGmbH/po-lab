# Implementation research — notes vs three `source/` repos

**Date:** 2026-06-07  
**Sources:** `journeys/source` @ `25376b6`, `email-worker/source` @ `1317df8`, `core-node/source` @ `5d91940`

## Summary

PRD target is largely unbuilt. Three partial approaches exist; none implements full in-line agentic extraction.

| Repo | Approach | PRD gap |
|------|----------|---------|
| **email-worker** | Classification: exact + `LIKE` guess on issuer | Guesses; no resolve call; no Participantes |
| **journeys** | `resolve-directory.helper.ts` — fuzzy entity matcher | Claim API only; no address pick; not agentic |
| **journeys** | `provision.lookup-directory.data.ts` — waterfall | Can guess (`rows[0]`); entity-only |
| **core-node** | None | N/A |

## Key code locations

- **Resolve kernel (only file with `resolveEntity`):** `journeys/.../resolve-directory.helper.ts`
- **Participantes reads (no writes):** `provision.lookup-directory.data.ts`, invoice inbox/mapper, `ProvisionTenantSection.tsx`
- **Participantes absent from email-worker app code** (only unrelated participante tables in `tenantdb.d.ts`)

## PRD gaps

- No in-line resolve at extraction (email-worker)
- No Participantes writer anywhere
- No `resolution_status` column
- No agentic loop / `recommendations[]`
- No provision gate (entity + address + resolved)
- Guess paths: classification `LIKE`, provision `rows[0]`

## Reuse vs build

**Reuse:** `resolve-directory.helper.ts` as `POST /resolve-entity` kernel.  
**Build:** email-worker integration, Participantes upsert, address selection, status derivation, agent orchestrator, retire guess paths, provision gate.

See prior chat for full gap matrix and scenario analysis.
