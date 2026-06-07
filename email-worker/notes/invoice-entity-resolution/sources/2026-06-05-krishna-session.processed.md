## Summary

Working session (2026-06-05) between Carlos and Krishna on how the AI Invoice Processing module resolves an AP invoice's vendor to a directorio **entity + address**, and where to store the result. They turned the resolver into an **agentic** flow and locked the data model. Key moves: call the `resolve-entity` endpoint **in-line** from the existing extraction code rather than adding a new workflow activity (which other activities would have to wait on); run the agentic resolution **only for the accounts-payable tag** to avoid wasted cost on commercial/signature/unknown docs; resolve **once at extraction time** and store the entity ID + entity-address ID in the `factura extraída` object **without re-fetching the document**; and revive the dormant **`Factura Extraida Participantes`** table, populating it in the same extraction step (it holds the *final* directorio attempt and is where provision creation operates). Carlos walked the entity model on screen (global directory, address reuse by sister offices, branches as same legal entity within one country, 1 company + 1 address per invoice) and defined ambiguity handling via a capped-attempt agentic loop, a three-scenario taxonomy, and a hard **provision-creation gate** (no entity-address ID → flag incomplete → force manual selection). Krishna took the implementation.

## Decisions

- **Call `resolve-entity` in-line, not as a new activity** (Krishna's argument, Carlos agreed) — avoids the pipeline waiting on an extra activity that downstream workflows depend on.
- **Run the agentic resolution only for the AP tag** — commercial-invoice / signature / unknown skip it, to avoid costly agentic calls.
- **Resolve once at extraction time; don't re-fetch the document** in the agent (cost). Store the resolved `set-identity-directorio` (entity ID) + `set-identity-directorio-direccion` (entity-address ID) inside the existing extraction object — no new column.
- **Populate `Factura Extraida Participantes` in the same extraction step** (table exists but isn't currently written to). The `clasificación activo digital` directorio is only the *first* attempt; Participantes holds the *final* attempt and is where provision creation runs (needs the entity-address ID). Avoids extracting the invoice twice.
- **Entity model:** one entity created once, reused by sister offices that add their own address; all addresses under an entity are the **same legal entity in the same country** (multi-country is blocked = different entity); branches get separate AP/AR repositories, so provisions attach to the **branch**, not the parent; an invoice is **always one company + one address (1:1)** → fetch both the parent entity ID and the specific branch address ID. **Pass the country code** to disambiguate cross-country name collisions.
- **Resolve ambiguity with an agentic loop** (capped attempts, multiple tools); the endpoint response returns candidate companies + **recommendations** that steer the agent.
- **Three ambiguity scenarios:** (1) PDF-level (correct company hidden in small print, wrong one in the top-right); (2) duplicate/low-quality directorio data (two entity IDs — e.g. two "Logic Solutions"; MSC "SA" vs "S A", same address, same tenant → fully ambiguous → block + flag for human); (3) company doesn't exist for that tenant (entity ID found, no entity-address ID for the processing office — e.g. Schryver Morocco).
- **Provision-creation gate:** require entity ID **and** entity-address ID; if missing, flag the record incomplete and force the user to select manually. Booking still requires human approval.

## Action Items Staged

- `[ ]` **Refactor vendor resolution into the agentic `resolve-entity` flow** (Krishna owns implementation) — in-line endpoint call (no new activity), AP-tag-only agentic run, resolve-at-extraction + store entity/address IDs + populate `Factura Extraida Participantes`, capped-attempt ambiguity loop over the three scenarios, and the provision-creation gate. Staged `[ ]` (working-session item, pending Carlos's review — not auto-pushed). → `Topics/logic-journeys.md`

## Action Items Updated

- **Clean up duplicate directorio entries sharing a tax ID** (existing, still open) — appended an `Update 2026-06-05` sub-bullet: this transcript reframes it as the **scenario-2** ambiguity class, adds the MSC ("SA" vs "S A") and two-"Logic Solutions" examples, and spells out the human-resolution path (close/migrate invoices off a duplicate → deactivate it; `tenant` + `status` matter). It is the manual step behind the new provision-creation gate. Marker left unchanged (still open).

## Memory Updated

- **Projects/Logic Journeys.md** — new section *"Entity (directorio) resolution — agentic `resolve-entity` flow, AP-only, Factura Extraida Participantes, ambiguity scenarios + the provision gate (2026-06-05)"* with sub-sections on the entity model, the agentic ambiguity loop + three scenarios, and the provision gate.
- **Entities/Logic Solutions/People/Krishna Kapadia.md** — new *Update 2026-06-05* section + a new Open Loop capturing the resolve-entity refactor he owns.
- **Topics/logic-journeys.md** — staged the new work item and updated the directorio-cleanup item (above).
- *Memory.md (global): no change — nothing global shifted.*

## Open Questions

- None blocking. (Carlos did not explicitly commit in-call to send Krishna a written spec for this design, though that mirrors the established pattern from prior sessions — left unstaged absent an explicit commitment; surface it if Krishna ends up blocked.)
