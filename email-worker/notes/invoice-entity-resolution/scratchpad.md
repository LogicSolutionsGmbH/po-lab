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

## Open
- Prototype location: standalone `po-lab/logic-sdk/` (recommended) vs `email-worker/prototypes/`.
- Package granularity (workspace-of-packages vs umbrella); executor boundary (raw `query()` vs
  accept-Kysely adapter) — journeys kernel uses Kysely `sql` templates, decide early.
- Which other shared capabilities are imminent (so `core` is shaped for them).
- Reconcile contract drift before build (exact_match/matched, recommendations/hints, entity_address_id, eori).
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
