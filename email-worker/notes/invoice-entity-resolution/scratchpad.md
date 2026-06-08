# invoice-entity-resolution — scratchpad

## Scope
Deep-dive notebook on AP-invoice vendor → directorio entity+address resolution
(agentic `resolve-entity` flow), seeded from the 2026-06-05 Krishna working session.

## Done
- Created notebook scaffold: `00-index.md`, `sources.md`, `notes/`, `sources/`.
- Pulled in source material: copied processed transcript + raw VTT into `sources/`.
- Wrote seed notes from the transcript:
  - `notes/01-entity-model.md` (directory, address reuse, branches, 1:1 rule, normalization)
  - `notes/02-resolve-entity-endpoint.md` (endpoint, in-line call, AP-only, storage, Participantes)
  - `notes/03-ambiguity-scenarios.md` (agentic loop, 3 scenarios, provision gate)
  - `notes/04-open-questions.md`
- **PRD v1.0:** `PRD-resolve-entity.md` — two-part doc (PRD + technical spec) for Krishna.
- **Implementation research (2026-06-07):** `notes/05-implementation-research.md` — compared PRD vs
  pulled `journeys/`, `email-worker/`, `core-node/` source. Key finding: `resolve-directory.helper.ts`
  is the resolve kernel (Claim API only); extraction + Participantes + agentic loop + provision gate unbuilt.
- **Opus critique (2026-06-07):** `notes/06-opus-critique.md` — two main objections: (1) **placement** —
  resolution must be a single shared service/endpoint (preferred home: core-node), not worker-local code,
  to avoid a 3rd divergent resolver; PRD's "in-line" should mean in-line *call*, not in-line *logic*.
  (2) **agentic is wrong tool** — deterministic engine already exists + better fits never-guess; real
  lever is richer extraction + learned-alias table; reserve LLM for extraction, not resolution.
  Codex invited as second critic before PRD finalize.
- **Codex critique (2026-06-07):** `notes/07-codex-critique.md` — confirms shared-endpoint ownership
  requirement and argues worker should call the resolver in-line but not own resolver logic.
  Recommends deterministic gatekeeper + optional bounded LLM assist + migration plan to retire guess paths.
- Updated `00-index.md` with research + critique links.

## Decided (2026-06-07, architecture session)
- **Placement = in-process SDK, not an API.** core-node's JWT/session auth is the wrong boundary;
  the worker already holds its own per-tenant pool and the resolver kernel is pure over an injected
  `db`. Hosts import and call directly, inheriting their own connection. CLI/HTTP = optional thin
  adapters over the same core, later.
- **The Logic SDK is general-purpose** — home for many shared capabilities; entity-resolution is
  capability #1. Tooling: **pnpm** (workspace, `workspace:*`, `--filter`), not npm.
- **Next session = prototype**, two parallel tracks: (A) prove in the worker via existing
  `getTenantInstance` pool; (B) build `logic-sdk` (core executor boundary + entity-resolution).
  Prototype in po-lab first; extract to its own repo later.
- Handoff written: `HANDOFF-logic-sdk-prototype.md` (start here). `HANDOFF-resolve-entity.md`
  transport (§2.1/§4 core-node API) marked superseded; its logic/contract/ACs remain valid.

## Prototype design decisions (2026-06-07, grill session)
Grounded by reading the kernel (`journeys/.../resolve-directory.helper.ts`), the worker's
`tenant.connection.ts` / `valid.tenants.ts`, and the journeys Claim caller
(`invoices.claim.supplier.data.ts`). Decisions:

1. **Executor boundary = accept Kysely.** Kernel is welded to Kysely `sql` tag across 6 DB
   methods (`sql.join`, conditional fragments); both real consumers (worker + journeys) are
   Kysely `^0.28.9`. Port kernel as-is behind `kyselyExecutor(db)`; raw `query()` port deferred.
2. **Output = flat §4.2 contract via a thin mapping layer** over the unchanged kernel. Kernel's
   `{resolution, entity{addresses[]}}` is treated as an internal intermediate; address-pick +
   `resolution_status` derivation (`ambiguous_address`/`address_not_for_tenant`) live in the map.
3. **Learned-alias = read-only DB path** against a hand-seeded `directorio_resolved_alias` row
   (proves TC-10/AC-11). **Drop the in-memory `AliasCache` from the decision path** (per-process,
   TTL-evicted → wrong for a multi-host in-process SDK; demote to optional perf cache only).
   Write-back (human-confirm) deferred to build phase (no UI in prototype).
4. **Public shape = pure function** `resolveEntity(executor, {tenantId, signals})`; no
   module-level singletons; internals instantiated per-call.
5. **Config = hardcoded default profile** (current weights/thresholds), optional injected
   override; no DB-resident tunables in the prototype.
6. **Location/granularity = standalone `po-lab/logic-sdk/` pnpm workspace, ONE package** with
   `core` + `entity-resolution` as internal folders; split into workspace-of-packages later.
7. **Scenario validation = hybrid**: read-only against a designated **dev/staging tenant DB**
   (pin expected `resolution_status` per scenario) + seed only what live data can't guarantee
   (TC-10 alias; any missing TC-4/5/8 ambiguity rows). Need: named dev tenant + DB.
8. **directoryTenantId source — CORRECTED 2026-06-08 (Carlos).** It is NOT from the email
   account/mailbox. It is `TESch_FacturaExtraida.cd_identityTenant`, and **`cd_identityTenant`
   = `cd_identityDatosRFC`**. That value is derived from the **invoice recipient** (the company
   being billed) and is **written by the worker in a LATER activity** (not the current
   `storeExtractedInvoice`, which inserts the header without it). Multiple tenants/sedes per DB
   is confirmed. (Worker's `TenantInstanceConfig.tenantId = cd_identityCliente` from MySQL
   `TCExi_Clientes` is a *different* id space — only selects the MSSQL pool, not the directorio
   tenant.)
   - **Two resolutions per AP invoice** (per `01-entity-model.md`: tenant + recipient):
     (1) recipient → `cd_identityTenant`; (2) supplier → `entity_id`+`entity_address_id`, scoped
     to that tenant group. Step 2 depends on step 1's output.
   - **Worker pipeline becomes:** extract+`storeExtractedInvoice` (exists) → [new activity]
     recipient→`cd_identityDatosRFC` + `UPDATE …FacturaExtraida.cd_identityTenant` → [new
     activity] supplier resolve (reads `cd_identityTenant`) → Participantes (build phase).
9. **Worker scope = SUPPLIER resolve-and-validate only.** Prototype targets capability #1
   (supplier). Source `cd_identityTenant` by reading `TESch_FacturaExtraida.cd_identityTenant`
   if set, else **seed/hardcode per test invoice**. Call capability, log/assert outcomes vs TCs;
   **no** Participantes upsert, **no** provision gate (need `resolution_status` migration +
   codegen = out of scope). **Recipient→tenant activity = build-phase sibling** — likely the
   same SDK capability reused with a tenant-own scope (or a simpler exact-`tax_id` lookup, since
   the recipient is one of a small finite set of the tenant's own RFCs).
10. **candidate_names[] = wrapper-level best-of**: run matcher per candidate name; one entity →
    `resolved`, differing entities → `ambiguous_entity` (never silently pick). Kernel untouched.
    Proves TC-11.
11. **Failure semantics**: capability never throws for business outcomes; **typed throw on infra
    errors only** → worker try/catch marks unresolved/incomplete + blocks + logs, pipeline does
    not crash, never guesses (in-process analog of AC-14). Emit §9 observability bundle to an
    injected logger sink.

## Prototype built (2026-06-08)
- `../../../logic-sdk/` — pnpm workspace, `@logic/entity-resolution` capability #1. Implements all
  grilled decisions; ported kernel + flat contract + alias read + address/status + candidate_names
  + Track A harness. typecheck/build green; harness runs on placeholder env (needs real values).
  See `logic-sdk/scratchpad.md`.

## Open
- **Need from Carlos:** named dev/staging tenant + DB for the hybrid scenario suite, and the
  seeded/hardcoded `cd_identityTenant` (= `cd_identityDatosRFC`) per test invoice/tenant.
- **Build-phase design:** recipient→`cd_identityTenant` activity — same SDK capability (tenant-own
  scope) vs simpler exact-`tax_id` lookup; and where in the worker pipeline it runs.
- Which other shared capabilities are imminent (so `core` is shaped for them).
- Reconcile residual contract drift before build (exact_match/matched, recommendations/hints, eori typo).
- Build-phase (post-prototype): `resolution_status` column + `directorio_resolved_alias` migrations +
  codegen; Participantes upsert + provision gate; alias write-back; mailbox→office mapping; retire
  guess paths (`LIKE` first-hit, `rows[0]`).
- Send PRD to Krishna (Carlos action).
- UI surfacing for incomplete records (post-v1; Carlos + Ariana).
- Confirm city/address availability at extraction for retry params.
- Cross-link from `Projects/Logic Journeys.md` entity-resolution section to this notebook (ask before editing project file).

## Assumptions
- Notebook folder name: `invoice-entity-resolution` (lowercase-hyphenated, per Notebooks convention).
- Copied (not moved) the transcript/vtt so originals stay in `Transcripts/`.

## Links
- PRD-resolve-entity.md
- ../README.md
- ../../Transcripts/processed/2026-06-05-2026-06-05-c56509bb577d-be74893799a1.md
- ../../Topics/logic-journeys.md
- ../../Projects/Logic Journeys.md
