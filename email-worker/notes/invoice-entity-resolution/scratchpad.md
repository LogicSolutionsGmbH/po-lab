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
- **Placement decided (2026-06-07):** `logic-core-node` owns `resolve-entity`; everyone else is a client.
- **Build handoff (2026-06-07):** `PRD-resolve-entity-core-node.md` (v2.0) — directs a fresh session to
  build a deterministic resolver module in core-node by porting the journeys kernel
  (`resolve-directory.helper.ts`) and adding address selection, `resolution_status` (5-value), and a
  durable learned-alias store. No LLM in resolution. Grounded in core-node conventions (Zod, `req.tenantDb`,
  `db`-first services, `/Global/TenantEntities/` routes). Locks contract drift: `eori`, single
  `resolution_status`. Supersedes v1.0 implementation approach (v1.0 kept for product requirements).
- Updated `00-index.md` with research + critique + v2.0 handoff links.

## Open
- Reconcile remaining contract details with consumers when they integrate (out of scope of v2.0 handoff).
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
