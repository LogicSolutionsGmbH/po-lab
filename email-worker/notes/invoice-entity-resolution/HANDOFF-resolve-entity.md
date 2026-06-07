---
doc: build-handoff
feature: resolve-entity
supersedes: PRD-resolve-entity.md (v1.0)
version: 2.0
date: 2026-06-07
status: ready-for-implementation
authors: Carlos Marquez (product), Opus + Codex (architecture critique)
---

# Build Handoff — `resolve-entity` (shared directorio resolution)

> **For a fresh implementation session.** This document is self-contained: it carries all
> context, decisions, contracts, and steps needed to build the feature without access to the
> originating chat. Where it differs from `PRD-resolve-entity.md` v1.0, **this document wins** —
> the changes come from two architecture critiques (`notes/06-opus-critique.md`,
> `notes/07-codex-critique.md`).

---

## 0. TL;DR for the implementer

Build **one shared, deterministic entity-resolution endpoint** and make every surface call it.

- **Service home:** `logic-core-node` (NestJS backend). One owner. Versioned HTTP endpoint.
- **Engine:** port the existing deterministic matcher from `logic-journeys`
  (`resolve-directory.helper.ts`) — do **not** write a new matcher, do **not** use an LLM as the
  resolver.
- **Consumers (all call the endpoint, none re-implement):** `logic-email-worker` (AP extraction),
  `logic-journeys` Claim tab, `logic-journeys` provision flow, future AR/import/manual tools.
- **Worker:** after extraction, make an **in-line HTTP call** to the endpoint (no new Temporal
  activity, no resolver logic in the worker).
- **Decision is deterministic and auditable.** Never guess. Ambiguity → block → human selects.
- **LLM is allowed only at extraction time** to harvest signals (candidate issuer names, ids,
  city, address). It is **never** the gatekeeper of the resolution decision.
- **Persist** `resolution_status` on `TESch_FacturaExtraidaParticipantes`; build a human-confirmed
  **learned-alias** store that the resolver reads.

---

## 1. Background & problem

The AI Invoice Processing module ingests emails, classifies attachments, and extracts
accounts-payable (AP) invoices. Before an invoice can become a **provision** (and later a
booking), its vendor must be resolved to a directorio **entity** and a specific **entity-address**
for the processing tenant.

Today's directorio data is dirty: duplicate entities, near-identical names ("SA" vs "S A"),
per-tenant address gaps. Direct queries return ambiguous results. Booking the **wrong supplier**
is the catastrophic failure. Therefore the system must **resolve precisely or block** — never
guess.

### Current state (from source @ 2026-06-07)

| Repo | Today | Problem |
|------|-------|---------|
| `logic-email-worker` | Classification matches issuer by exact name, else `LIKE '%name%'` first hit. Extraction pulls only tax_id + financials. | Guesses on ambiguity; no vendor name/address extracted; no resolution; writes nothing to Participantes. |
| `logic-journeys` | `resolve-directory.helper.ts` — strong deterministic matcher, wired only to the Claim tab. | Not reused elsewhere. |
| `logic-journeys` | `provision.lookup-directory.data.ts` — separate 7-step waterfall ending in supplier-name search returning `rows[0]`. | Guesses; entity-only (no address); divergent from the kernel. |
| `logic-core-node` | No resolution logic. | — |
| DB | `TESch_FacturaExtraidaParticipantes` exists but is **never written**; has no `resolution_status`. | Dead storage. |

**Net:** the resolver already exists once and is already half-duplicated. The fix is to
**consolidate**, not to add a third copy in the worker.

---

## 2. Architecture decision (the core of this handoff)

### 2.1 Single shared resolution service in core-node

`resolve-entity` is a **directorio concern**, consumed by many surfaces. It must be **one service
with one owner**, because it is stateful (per-tenant directorio queries, alias cache, learned
aliases) — a copied library would fragment that state.

**Decision: build it in `logic-core-node` (NestJS).**

Why core-node and not journeys:

- Both a background worker and a UI app can legitimately depend on a **backend API**. A worker
  depending on the Next.js UI app (journeys) is an inverted, fragile dependency (UI deploys would
  bounce the extraction hot path).
- core-node already owns tenant context, auth, and DB access patterns.
- The kernel is pure TypeScript with no Next.js/Temporal coupling → ports directly as a NestJS
  service.

**Interim allowance:** if core-node adoption blocks delivery, journeys MAY expose a temporary
`POST /api/directory/resolve-entity`. Mark it explicitly interim; the target remains core-node.

### 2.2 Deterministic engine, not an agent

The resolver decision is deterministic, reproducible, and auditable. Reasons:

- "Never guess" is a hard, money-critical invariant. A stochastic LLM is a poor gatekeeper for it.
- The acceptance tests are deterministic assertions; the engine must reproduce status run-to-run.
- The existing matcher already covers the hard cases (legal-suffix normalization, fuzzy, phonetic,
  ambiguity detection, tenant-group expansion).

The PRD v1.0 "agentic loop (max 3 attempts)" is **replaced** by: extract rich signals once →
resolve once → deterministic status → block or proceed. Retries only happen if a **cheap,
deterministic** enrichment is available (e.g. a learned-alias hit), never as an LLM loop.

### 2.3 Where the LLM is allowed

- **Extraction time only:** harvest the signal bundle (all candidate issuer names, tax_id(s),
  EORI, city, address, country) from the document. This is genuine language understanding.
- **Offline (optional):** suggest alias links for human approval into the learned-alias store.
- **Never** as the live resolution decision.

### 2.4 Topology (PRD's valid constraint, preserved)

The worker calls resolution **in-line within the existing extraction code path** — not as a new
Temporal activity that downstream workflows must wait on. "In-line" = in-line **call** to the
shared endpoint, not in-line **logic**.

```
email-worker (extract activity) --in-line HTTP--> core-node POST /v1/directory/resolve-entity
journeys (Claim, provision)     --------------->  (same endpoint)
future tools                    --------------->  (same endpoint)
                                                   |
                                                   v
                                    deterministic resolver + learned-alias store
                                                   |
                                                   v
                                        TCSch_Directorio* (per tenant)
```

---

## 3. Scope

### In scope (v2)

1. core-node `resolve-entity` endpoint (port kernel + address selection + status derivation).
2. Learned-alias store (human-confirmed) read by the resolver.
3. email-worker: rich signal extraction + in-line resolve call + Participantes write.
4. `resolution_status` column on Participantes + codegen across consumers.
5. journeys: provision gate reads Participantes status; retire `rows[0]` guess.
6. Retire email-worker classification `LIKE` first-hit guess.

### Out of scope (v2)

- Agentic/LLM resolution loop.
- Directorio duplicate-cleanup tooling (manual data-quality task; tracked separately).
- Changing the booking-approval flow (booking still needs human approval).
- AR/client resolution wiring (endpoint must not preclude it, but not built now).

---

## 4. Endpoint contract (lock this before building)

Resolve all naming drift now (PRD `exact_match` vs engine `matched`, `recommendations[]` vs
`hints[]`, `eri` typo vs `eori`). The contract below is canonical for v2.

### 4.1 Request

```
POST /v1/directory/resolve-entity
```

```jsonc
{
  "tenant_id": 123,                 // required — processing office/tenant
  "signals": {
    "entity_name": "string|null",   // >=1 strong signal required (name|tax_id|eori)
    "tax_id": "string|null",
    "eori": "string|null",
    "country_code": "string|null",
    "city": "string|null",
    "address_line_1": "string|null",
    "candidate_names": ["string"]   // NEW: all issuer-name candidates from extraction
  },
  "confirm_match": { "entity_id": 456 } | null  // manual confirmation path
}
```

### 4.2 Response

```jsonc
{
  "status": "resolved | ambiguous | not_found",   // single canonical enum
  "entity_id": "number|null",
  "entity_address_id": "number|null",             // single selected address, null if ambiguous
  "resolution_status": "resolved | ambiguous_entity | ambiguous_address | address_not_for_tenant | not_found",
  "confidence": "number|null",
  "candidates": [
    {
      "entity_id": 1, "entity_address_id": 2,
      "name": "string", "country": "string", "city": "string",
      "tenant": 123, "active": true,
      "confidence": 0, "match_tier": "exact|strong|probable|weak"
    }
  ],
  "reason": "human-readable explanation",
  "hints": ["missing-signal guidance, UI-facing"]   // input-completeness only, NOT agent steering
}
```

**Status vs resolution_status:** `status` is the coarse endpoint outcome; `resolution_status` is
the fine-grained value persisted on Participantes and used by the provision gate. Derivation:

| resolution_status | Condition | entity_id | entity_address_id |
|-------------------|-----------|-----------|-------------------|
| `resolved` | one entity + one tenant address, unambiguous | set | set |
| `ambiguous_entity` | >=2 distinct entity_ids survive | null/best-effort | null |
| `ambiguous_address` | one entity, >=2 tenant addresses, can't narrow | set | null |
| `address_not_for_tenant` | entity found, no address for processing tenant | set | null |
| `not_found` | no entity match | null | null |

`address_not_for_tenant` is **derived** (entity match + zero tenant addresses), not a raw engine
status — implement the derivation explicitly.

---

## 5. Engine port (core-node)

Source to port: `journeys/source/src/server-actions/api/directory/resolve-directory.helper.ts`.
It is framework-agnostic TypeScript. Keep its logic; wrap it in a NestJS service.

Keep as-is:

- Name normalization (diacritics, punctuation, **legal-suffix stripping**).
- Weighted multi-signal scoring (tax_id 40, eori 35, name 20, country 3, city 2).
- Fuzzball token-set + double-metaphone phonetic fallback.
- Tenant-group expansion (`findRelatedTenantIds`) — implements sister-office address reuse.
- Clear-winner gap rule for matched vs ambiguous.
- `confirm_match` path -> manual selection.

Add:

- **Address selection:** from the matched entity's tenant addresses, pick one using city/country/
  address_line_1 signals; if >1 viable -> `ambiguous_address`; if 0 -> `address_not_for_tenant`.
- **`resolution_status` derivation** (table in section 4.2).
- **Learned-alias lookup** (see section 6) before scoring; a confirmed alias short-circuits to
  `resolved`.
- **`candidate_names` handling:** score each candidate name, take the best; this is how a
  misleading PDF (correct issuer in small print) gets resolved — by extraction supplying
  alternatives, not by an agent re-reading the doc.

---

## 6. Learned-alias store (the compounding win)

Every human resolution should make the next identical invoice auto-resolve — deterministically.

- New table (core-node-owned), e.g. `directorio_resolved_alias`:
  `tenant_id, normalized_signal (name/tax/eori), entity_id, entity_address_id, confirmed_by,
  confirmed_at, status`.
- Written when a human confirms a resolution in the UI (Claim/provision manual selection).
- Read by the resolver as a first-class, high-confidence signal (replaces PRD's
  `check_previous_resolutions` agent tool with a deterministic lookup).

---

## 7. Per-repo work

### 7.1 core-node (`logic-core-node`)

1. `DirectoryModule` + `ResolveEntityService` (ported kernel + address selection + status).
2. `POST /v1/directory/resolve-entity` controller with the section 4 contract + validation.
3. `directorio_resolved_alias` table + read/write paths.
4. Auth/tenant guard consistent with existing core-node patterns.
5. Metrics/logs per section 9.

### 7.2 email-worker (`logic-email-worker`)

1. **Extraction enrichment:** extend the extraction step to emit the full signal bundle
   (candidate issuer names, tax_id(s), EORI, city, address, country) — not just tax_id + financials.
2. **AP gate:** only run resolution for the AP tag (reuse classification result).
3. **In-line call:** after `storeExtractedInvoice`, call core-node `resolve-entity`. No matcher
   code in the worker.
4. **Persist:** store `entity_id` + `entity_address_id` in the extraction object; **upsert**
   `TESch_FacturaExtraidaParticipantes` with ids + `resolution_status` + role.
5. **Retire** the classification `LIKE` first-hit guess; leave directorio null when unresolved
   (or call the endpoint there too).
6. **Failure mode:** if the endpoint is unreachable -> mark unresolved/incomplete and block
   provision (never guess); do not crash the extraction pipeline.

### 7.3 journeys (`logic-journeys`)

1. Claim tab: replace direct `resolveDirectoryEntityForDb` call with the core-node endpoint
   (or shared client).
2. Provision: replace the `rows[0]` waterfall fallback with a Participantes read + the endpoint;
   **retire the guess**.
3. **Provision gate:** enable creation only when `entity_id` AND `entity_address_id` present AND
   `resolution_status = resolved`. Otherwise surface incomplete + manual selection.
4. Manual selection writes back to the learned-alias store (section 6).

### 7.4 DB / codegen

1. Add `resolution_status` (e.g. `st_resolutionStatus`) to `TESch_FacturaExtraidaParticipantes`.
2. Add `directorio_resolved_alias`.
3. Regenerate `tenantdb.d.ts` (kysely-codegen) in **every** consumer repo.

---

## 8. Acceptance criteria

| ID | Criterion |
|----|-----------|
| AC-1 | Exactly one resolver implementation exists; worker contains **no** matcher logic |
| AC-2 | AP extraction makes an in-line call to the shared endpoint; no new Temporal activity |
| AC-3 | Non-AP tags do not trigger resolution |
| AC-4 | Resolved AP invoice has entity_id + entity_address_id in extraction object AND a Participantes row |
| AC-5 | Participantes row carries correct `resolution_status` per section 4.2 |
| AC-6 | Provision creation blocked unless `resolution_status = resolved` with both ids |
| AC-7 | MSC "SA" vs "S A", same address, same tenant -> `ambiguous_entity`, blocked, never auto-picked |
| AC-8 | Schryver Morocco / Logic Solutions (entity, no tenant address) -> `address_not_for_tenant` |
| AC-9 | Unknown vendor -> `not_found`, blocked |
| AC-10 | One entity, two similar addresses; city narrows to one -> `resolved`; else `ambiguous_address` |
| AC-11 | A prior human confirmation auto-resolves an identical vendor+tenant deterministically |
| AC-12 | Resolution decision is reproducible run-to-run for identical input (no stochastic step) |
| AC-13 | `LIKE` first-hit (worker) and `rows[0]` (provision) guess paths are removed |
| AC-14 | Endpoint-down -> invoice marked incomplete + provision blocked; pipeline does not crash |

---

## 9. Observability (mandatory)

Per resolve call, emit: input signal completeness, `status` + `resolution_status`, ambiguity type
(entity vs address), candidate count, learned-alias hit (bool), manual-override count, p50/p95
latency. Without these, threshold tuning and quality claims are guesswork.

---

## 10. Test scenarios (deterministic)

| TC | Input | Expected resolution_status | Gate |
|----|-------|---------------------------|------|
| TC-1 | Clean vendor, one entity + address | resolved | open |
| TC-2 | Name only, unique match w/ country | resolved | open |
| TC-3 | Two "Logic Solutions" entity ids | ambiguous_entity | blocked |
| TC-4 | MSC SA vs S A, same address | ambiguous_entity | blocked |
| TC-5 | Logic Solutions, Morocco tenant, no MA address | address_not_for_tenant | blocked |
| TC-6 | Unknown vendor | not_found | blocked |
| TC-7 | One entity, 2 addresses, city narrows | resolved | open |
| TC-8 | One entity, 2 addresses, can't narrow | ambiguous_address | blocked |
| TC-9 | Commercial-invoice tag | (no resolution / no Participantes) | n/a |
| TC-10 | Prior confirmed alias for vendor+tenant | resolved (via alias) | open |
| TC-11 | Misleading PDF; correct issuer among `candidate_names` | resolved | open |
| TC-12 | core-node endpoint unreachable | unresolved/incomplete | blocked |

---

## 11. Build order (suggested)

1. Lock the section 4 contract (naming, status semantics).
2. core-node: port engine, add endpoint (no alias/address yet) — parity with journeys Claim.
3. Add address selection + `resolution_status` derivation.
4. DB: `resolution_status` column + codegen.
5. email-worker: extraction enrichment -> in-line call -> Participantes upsert.
6. journeys: provision gate + retire `rows[0]`; Claim -> endpoint.
7. Learned-alias store + write-back from manual selection.
8. Retire worker `LIKE` guess.
9. Observability + acceptance tests.

---

## 12. Open decisions for the build session

- **Transport:** raw HTTP vs a thin shared typed client/SDK package for callers.
- **core-node DB access:** confirm core-node can reach the per-tenant directorio DBs the same way
  journeys does (tenant connection strategy).
- **Latency budget** on the extraction hot path + timeout/retry policy for the in-line call.
- **Alias store scope:** name-only vs (name+country) vs (tax_id) keys; dedupe/expiry policy.
- **Interim home:** start in core-node, or ship interim in journeys then migrate? (Prefer
  core-node from the start.)

---

## References

- Original product spec: `PRD-resolve-entity.md` (v1.0) — superseded by this doc where they differ.
- Critiques: `notes/06-opus-critique.md`, `notes/07-codex-critique.md`.
- Gap research: `notes/05-implementation-research.md`.
- Entity model: `notes/01-entity-model.md`.
- Engine to port: `journeys/source/src/server-actions/api/directory/resolve-directory.helper.ts`.
- Guess paths to retire: `provision.lookup-directory.data.ts`,
  `email-worker/.../store.attachment.classification.ts`.
- Session source: `sources/2026-06-05-krishna-session.*`.
