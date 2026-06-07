---
notebook: invoice-entity-resolution
status: active
started: 2026-06-06
project: "[[Projects/Logic Journeys]]"
topic: "[[Topics/logic-journeys]]"
owner-dev: "[[Entities/Logic Solutions/People/Krishna Kapadia]]"
---

# Invoice Entity (Directorio) Resolution — deep dive

Deep dive on how the **AI Invoice Processing module** resolves an AP invoice's vendor to a
directorio **entity ID + entity-address ID**, turns it into an **agentic `resolve-entity` flow**,
and gates provision creation on a complete resolution.

Anchored on the **2026-06-05 working session with Krishna** (see `sources/`).

## Scope / the core question

For an AP invoice, deterministically (or agentically) answer:
**which directorio entity + which entity-address** does this vendor map to — and if we can't,
fail loud and force a human to pick, never guess.

## Status

- **Design locked** in the 2026-06-05 session. Krishna owns implementation ("let me work on that").
- **PRD ready:** [[PRD-resolve-entity]] (v1.0, 2026-06-06) — send-ready for Krishna.
- Tracked as a staged item in `[[Topics/logic-journeys]]` → *Refactor vendor resolution into the agentic `resolve-entity` flow*.

## Design at a glance

1. **In-line call, not a new activity.** Call `resolve-entity` from inside the existing extraction
   code rather than adding a workflow activity (Krishna's argument: too many downstream workflows
   would have to wait on a new activity). Carlos agreed.
2. **AP-tag only.** Run the agentic resolution only for the accounts-payable tag; commercial /
   signature / unknown docs skip it to avoid wasted agentic cost.
3. **Resolve once, at extraction time.** Don't re-fetch the document inside the agent (cost).
   Store the resolved `set-identity-directorio` (entity ID) + `set-identity-directorio-direccion`
   (entity-address ID) inside the **existing extraction object** — no new column.
4. **Revive `Factura Extraida Participantes`.** The table exists but isn't written to today.
   Populate it in the **same** extraction step. The directorio in `clasificación activo digital`
   is only the *first* attempt; **Participantes holds the final attempt** and is where provision
   creation operates.
5. **Capped-attempt agentic ambiguity loop.** `resolve-entity` returns candidate companies +
   **recommendations** that steer the agent; it loops (max attempts, multiple tools) instead of
   guessing.
6. **Provision-creation gate.** Require entity ID **and** entity-address ID **and** `resolution_status = resolved`. If missing → flag incomplete → force manual selection. Booking still requires human approval.

## Decided (2026-06-06 PRD pass)

- **`resolve-entity` response:** 3 statuses (`exact_match | ambiguous | not_found`) + `candidates[]` + `recommendations[]` + `reason`.
- **`Factura Extraida Participantes.resolution_status`:** `resolved | ambiguous_entity | ambiguous_address | address_not_for_tenant | not_found` — derived from candidates.
- **Agentic loop:** max 3 attempts; tools = retry with more params, narrow by location, check previous resolutions; PDF re-fetch excluded.
- **Morocco case:** `address_not_for_tenant` (entity found, no tenant address) — human creates the address.

## Open threads

- [[notes/01-entity-model]] — global directory, address reuse by sister offices, branches, 1:1 invoice rule
- [[notes/02-resolve-entity-endpoint]] — endpoint params, in-line call, AP-only, storage decisions
- [[notes/03-ambiguity-scenarios]] — the three scenarios + the agentic loop + the provision gate
- [[notes/04-open-questions]] — remaining post-v1 items
- [[notes/05-implementation-research]] — **gap analysis: PRD vs journeys / email-worker / core-node source (2026-06-07)**
- [[notes/06-opus-critique]] — **Opus critique: placement/reuse + agentic-vs-deterministic (2026-06-07, Codex review pending)**
- [[notes/07-codex-critique]] — **Codex critique: shared endpoint ownership + deterministic gate (2026-06-07)**
- [[PRD-resolve-entity]] — original implementation spec (agentic/worker-local; superseded)
- [[HANDOFF-resolve-entity]] — resolution logic/contract/ACs (transport superseded → SDK)
- [[HANDOFF-logic-sdk-prototype]] — **START HERE next session: in-process Logic SDK prototype (pnpm), entity-resolution = capability #1**

## Sources

- `sources/2026-06-05-krishna-session.processed.md` — processed summary/decisions (copy)
- `sources/2026-06-05-krishna-session.vtt` — raw transcript (copy)
- Originals: `Transcripts/processed/2026-06-05-2026-06-05-c56509bb577d-be74893799a1.md`,
  `Transcripts/archive/2026-06-05-2026-06-05-c56509bb577d-be74893799a1.vtt`
- See `sources.md` for the full manifest + related KB links.
