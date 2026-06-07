---
doc: PRD / build handoff
feature: resolve-entity (core-node)
target-repo: logic-core-node (NestJS backend)
supersedes: PRD-resolve-entity.md v1.0 (implementation approach)
author: Carlos Marquez
critics: Claude Opus 4.8, Codex
status: ready-for-implementation
version: 2.0
date: 2026-06-07
---

# Build Handoff: `resolve-entity` in `logic-core-node`

**You are implementing in a fresh session. Read this whole doc before writing code.**

This is a **handoff to build a shared directory entity-resolution service inside `logic-core-node`**.
It supersedes the *implementation approach* of `PRD-resolve-entity.md` v1.0 (which assumed
worker-local, agentic resolution). The **product requirements** from v1.0 still hold; the
**architecture has changed** based on two critiques (`notes/06-opus-critique.md`,
`notes/07-codex-critique.md`):

1. Resolution is a **shared platform concern**, not a worker concern → build it once in core-node.
2. The resolver is **deterministic and authoritative**; LLM is not the gatekeeper.

> If anything here conflicts with v1.0, **this doc wins** for implementation.

---

## 0. TL;DR for the implementer

- Build a new NestJS module `src/resolve-entity/` in `logic-core-node`.
- **Port the existing deterministic resolver** from journeys
  (`journeys/src/server-actions/api/directory/resolve-directory.helper.ts`) into a core-node service.
  Do **not** invent a new matcher — that file is the reference algorithm.
- Expose `POST /Global/TenantEntities/resolve-entity/resolve`.
- Add what journeys' version lacks: **single address selection**, a **`resolution_status`**
  output, and a **learned-alias** read/write.
- **No LLM** in this service. Resolution is deterministic, reproducible, auditable.
- Consumers (email-worker extraction, journeys Claim, journeys provision) call this endpoint.
  Their integration is **out of scope for this handoff** (separate tickets) but the contract here
  is what they will depend on — keep it stable and versioned in spirit.

---

## 1. Why core-node (context, do not relitigate)

The resolver will be consumed by: email-worker (AP extraction), journeys Claim tab, journeys
provision flow, and future AR/import/manual tools. A worker-local implementation would create a
third divergent resolver (journeys already has two paths). Resolution is **stateful** (per-tenant
directorio queries, alias cache, learned aliases) so it must have **one owner**. core-node is the
shared backend both journeys and the worker can depend on without inverting the dependency graph
(a background worker must not depend on the Next.js UI app).

Decision: **core-node owns `resolve-entity`. Everyone else is a client.**

---

## 2. What already exists (your starting material)

### 2.1 In core-node (target repo) — conventions to follow exactly

| Topic | Convention | Reference |
|-------|-----------|-----------|
| Module layout | Flat folder: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.validator.ts`, `*.spec.ts` | `src/shipments/`, `src/users/` |
| Routes | `/Global/TenantEntities/{feature}/{action}`; **no `/v1`**, no global prefix; add to `src/config/routesconfig.ts` | `src/config/routesconfig.ts` |
| Validation | **Zod** schemas in `*.validator.ts` + `ZodValidationPipe` (not class-validator) | `src/utils/validation.pipe.ts`, `src/users/users.validator.ts` |
| DB access | **Kysely**; service methods take `db: Kysely<DB>` as **first arg** (never inject DB) | `src/users/users.service.ts` |
| Tenant DB | Per-request MSSQL at `req.tenantDb` (set by `TenantMiddleware` from JWT `cliente` → `TCExi_Clientes`). **Tenant is not a header.** | `src/middleware/tenant.middleware.ts` |
| Auth | Global middleware (`TenantMiddleware`, `AuthMiddleware`); `req.authData` for entity scoping. Feature controllers don't use `@UseGuards`. | `src/app.module.ts`, `src/lib/auth/` |
| Entity scoping | `getEntityIdsFromRequest(req, params)` from auth cookie | `src/utils/request.helper.ts` |
| Response shape | `TransformResponseInterceptor` wraps returns as `{ statusCode, success, message, data }` — **return plain objects** | global |
| Tests | Jest; pass a **mock `db`** object; `service.method(db, ...)` | `src/messages/messages.service.spec.ts` |
| Config | `@nestjs/config` `ConfigService`; `src/config/configuration.ts` | — |
| LLM | **None present.** Do not add one for this feature. | — |

DB type import: `import { DB } from 'src/database/tenantdb';` (table keys use underscores in query
strings, e.g. `'TCSch_Directorio'`; interfaces drop them, e.g. `TCSchDirectorio`).

### 2.2 In journeys — the algorithm to port (reference, do not edit)

`journeys/src/server-actions/api/directory/resolve-directory.helper.ts` is a mature deterministic
resolver. **Port its logic**, adapting to NestJS/core-node conventions. It already implements:

- Name normalization: diacritics, punctuation, **legal-suffix stripping** (`S.A.`, `GMBH`, `S A`
  vs `SA`, etc.) — critical for MSC-style variants.
- Weighted multi-signal scoring: `tax_id` 40, `eori` 35, `entity_name` 20, `country_code` 3, `city` 2.
- Fuzzy (`fuzzball.token_set_ratio`) + optional **double-metaphone** phonetic matching.
- An **alias cache** (tax_id/eori → entity_id) with TTL + max entries.
- **Tenant-group expansion** (`findRelatedTenantIds`): sister offices sharing a sede, so address
  reuse works.
- Clear-winner gap logic (`isClearWinner`) → returns `matched | ambiguous | not_found` + candidates
  + confidence + `hints[]`.
- Exact-identifier fast path; `confirm_match.entity_id` for explicit human confirmation.
- Address ranking by city/country signals (`rankAddressesBySignals`).

Dependencies it uses: `kysely` (`sql` raw queries with `WITH (NOLOCK)`), `fuzzball`,
`double-metaphone` (lazy import), `zod`. Add `fuzzball` and `double-metaphone` to core-node
`package.json`.

### 2.3 Gaps in journeys' version you must close

1. **No single address selection** — returns `entity.addresses[]`, never one `entity_address_id`.
2. **No `resolution_status`** — only `matched|ambiguous|not_found`; we need the 5-value enum.
3. **No `address_not_for_tenant` state** — entity can `matched` with empty `addresses[]`.
4. **No learned-alias persistence** — alias cache is in-memory only; we want a durable table.
5. **Contract naming drift** vs v1.0 PRD (`matched` vs `exact_match`, `hints` vs `recommendations`).

---

## 3. Scope

### In scope (this handoff)

- New core-node module `resolve-entity` with controller + service + validator + specs.
- Deterministic resolver ported from journeys.
- **Address selection** layer → single `entity_address_id` or an ambiguity/ￗno-tenant-address state.
- **`resolution_status`** derivation (5 values).
- **Learned-alias** read + write (durable, tenant-scoped).
- Stable response contract (§5) + observability (§8).

### Out of scope (separate tickets — name them in your PR description)

- email-worker calling this endpoint in-line at extraction + writing `TESch_FacturaExtraidaParticipantes`.
- journeys Claim + provision migrating to this endpoint; retiring their guess paths.
- DB migration for `TESch_FacturaExtraidaParticipantes.resolution_status` (worker-side store).
- Any LLM-assisted extraction.

---

## 4. Functional requirements

- **FR-1 — Deterministic only.** No LLM/agent in the resolve path. Same input + same DB state ⇒
  same output. Every decision must be explainable from `candidates` + `reason`.
- **FR-2 — Signal-driven.** Accept `entity_name`, `tax_id`, `eori`, `country_code`, `city`,
  `address_line_1`. At least one strong signal (`entity_name | tax_id | eori`) required.
- **FR-3 — Entity resolution.** Reuse the ported scoring engine to pick one entity or report
  ambiguity/not-found.
- **FR-4 — Address resolution.** Given the resolved entity, select **one** `entity_address_id`
  for the requesting tenant using `city`/`country_code`/`address_line_1`. If none exist for the
  tenant → `address_not_for_tenant`. If multiple remain and cannot be narrowed → `ambiguous_address`.
- **FR-5 — Status derivation.** Output `resolution_status ∈ { resolved, ambiguous_entity,
  ambiguous_address, address_not_for_tenant, not_found }` (see §5.3 + §6).
- **FR-6 — Never guess.** Below confidence threshold, multiple distinct entity_ids, or multiple
  tenant addresses that can't be narrowed ⇒ **do not pick**; return the ambiguous/ not-found status
  with `candidates` for a human. Never silently default to the first row.
- **FR-7 — Learned aliases.** Before scoring, check the learned-alias store for
  `(tenant, normalized_signal) → entity_id`. On a confirmed match (via `confirm_match`), persist
  the alias so identical future inputs resolve deterministically. (See §7.)
- **FR-8 — Tenant scoping.** Resolve tenant from `req` (middleware). Expand to the tenant group
  (sede/sister offices) for entity search, but address selection is for the **requesting tenant**.
- **FR-9 — Idempotent + side-effect-light.** A resolve call may write a learned alias only on
  explicit `confirm_match`; a plain resolve is read-only.

---

## 5. API contract

### 5.1 Route

```
POST /Global/TenantEntities/resolve-entity/resolve
```

Add to `src/config/routesconfig.ts`:

```ts
resolveEntity: '/Global/TenantEntities/resolve-entity',
```

Controller `@Post('resolve')`. Tenant + auth come from middleware (`req.tenantDb`, `req.user`,
`req.authData`). Body validated by `ZodValidationPipe`.

### 5.2 Request

```jsonc
{
  "signals": {
    "entity_name": "string?",      // >=1 of name/tax_id/eori required
    "tax_id": "string?",
    "eori": "string?",
    "country_code": "string?",     // 2-3 chars
    "city": "string?",
    "address_line_1": "string?"
  },
  "confirm_match": { "entity_id": 123 }  // optional: human-confirmed → resolve + persist alias
}
```

> **Naming decision (locks v1.0 drift):** keep code-native field `eori` (v1.0's `eri` was a typo).

### 5.3 Response (the contract consumers depend on)

Return a plain object (interceptor wraps it). Shape:

```jsonc
{
  "resolution_status": "resolved | ambiguous_entity | ambiguous_address | address_not_for_tenant | not_found",
  "entity_id": 123,                 // null unless entity unambiguous
  "entity_address_id": 456,         // null unless address unambiguous for tenant
  "confidence": 95,                 // null when not resolved
  "candidates": [
    {
      "entity_id": 123,
      "entity_address_id": 456,     // nullable
      "entity_name": "string",
      "country_code": "string",
      "city": "string",
      "tenant_id": 7,
      "active": true,
      "match_tier": "exact | strong | probable | weak",
      "matched_fields": [{ "field": "tax_id", "strategy": "exact_identifier", "score": 100 }]
    }
  ],
  "reason": "human-readable explanation"
}
```

> **Naming decision:** the **top-level status is `resolution_status` with the 5-value enum** (v1.0's
> 3-status endpoint + separate Participantes enum collapses into one authoritative field). This is
> what the provision gate keys off. Replaces journeys' `resolution: matched|ambiguous|not_found`
> and the separate `hints[]`.

---

## 6. `resolution_status` derivation (authoritative logic)

Compute after entity scoring + address selection. Port from journeys' outcome logic, then add the
address layer:

```
deriveStatus(entityOutcome, addressesForTenant):
  if entityOutcome == not_found OR no candidates:      return not_found
  if entityOutcome == ambiguous (multiple entity_ids): return ambiguous_entity
  # single entity resolved:
  if addressesForTenant.length == 0:                   return address_not_for_tenant
  if addressesForTenant.length == 1:                   return resolved        # set both IDs
  if addressesForTenant narrowed to 1 by signals:      return resolved        # set both IDs
  else:                                                return ambiguous_address
```

- `resolved` requires **both** `entity_id` and `entity_address_id` non-null and unambiguous.
- All non-`resolved` statuses set the relevant IDs to null and return `candidates` for the human.
- `address_not_for_tenant`: entity is real but the requesting tenant has no address (e.g. Morocco
  processing a Logic Solutions invoice with no Morocco address) → human creates the address.

Scenario expectations (port as test cases — see §9):

| Scenario | Expected `resolution_status` |
|----------|------------------------------|
| Clean vendor, one entity + one tenant address | `resolved` |
| Name-only, unique with country | `resolved` |
| Two distinct entity_ids ("Logic Solutions" x2) | `ambiguous_entity` |
| MSC "SA" vs "S A", same tenant + address | `ambiguous_entity` |
| Entity found, no address for processing tenant (Morocco) | `address_not_for_tenant` |
| Unknown vendor | `not_found` |
| One entity, two addresses, city narrows to one | `resolved` |
| One entity, two addresses, can't narrow | `ambiguous_address` |
| `confirm_match.entity_id` provided | `resolved` (+ persist alias) |

---

## 7. Learned-alias store (the compounding win)

Replace journeys' in-memory alias cache with a **durable, tenant-scoped** table so every human
confirmation makes the next identical input auto-resolve — deterministically.

- **Read:** before scoring, look up `(tenant_id, normalized_signal) → entity_id`. A hit short-
  circuits to that entity (still run address selection).
- **Write:** only on `confirm_match` (human-confirmed). Persist normalized `tax_id`, `eori`, and
  optionally normalized `entity_name`.
- **Normalization:** reuse the resolver's `normalizeIdentifier` / `normalizeEntityName`.

**Storage decision (flag for review, then implement chosen):**
- Option 1: new tenant table (e.g. `TESch_DirectorioAliasResuelto` or similar) — needs DB migration
  + `db2:codegen`. Preferred for durability + auditability.
- Option 2: reuse an existing alias/resolution table if one exists in the tenant DB (verify via
  codegen; none found in current core-node types).

Keep an in-process LRU on top for hot-path latency, but **the table is the source of truth.**

> The v1.0 "check_previous_resolutions" tool becomes this deterministic lookup — not an agent step.

---

## 8. Observability (mandatory)

Emit per resolve call (structured log + metric):

- input **signal completeness** (which signals were present),
- `resolution_status`,
- ambiguity type (entity vs address) when applicable,
- `confidence`,
- whether a learned-alias hit occurred,
- latency (record p50/p95).

Rationale: tuning the confidence threshold and proving quality improvements is impossible without
this. Use core-node's existing logging; add counters/timing around the service call.

---

## 9. Testing

Follow core-node jest conventions (mock `db`, call `service.resolve(db, input)`):

- Unit-test the **derivation logic** (§6 table) and normalization (suffix stripping, MSC variant).
- Unit-test address selection: 0 / 1 / many tenant addresses; narrow-by-city.
- Unit-test learned-alias read (hit short-circuit) and write-on-confirm.
- Controller spec: validation rejects empty-signals body; happy path returns wrapped envelope.
- Port journeys' implicit cases (exact identifier, ambiguous identifier disambiguated by name).

Acceptance:

| ID | Input | Expected |
|----|-------|----------|
| AC-1 | one strong signal required | empty signals → 400 (Zod) |
| AC-2 | clean vendor | `resolved` + both IDs |
| AC-3 | duplicate entities | `ambiguous_entity`, both IDs null, candidates present |
| AC-4 | MSC SA/S A same address | `ambiguous_entity` |
| AC-5 | Morocco no tenant address | `address_not_for_tenant`, entity_id set, address null |
| AC-6 | unknown | `not_found` |
| AC-7 | one entity, narrow by city | `resolved` |
| AC-8 | one entity, can't narrow | `ambiguous_address`, entity_id set, address null |
| AC-9 | `confirm_match` | `resolved` + alias persisted |
| AC-10 | learned alias exists | resolves without re-scoring |

---

## 10. Implementation steps (suggested order)

1. **Scaffold module**: `src/resolve-entity/{module,controller,service,validator}.ts` + specs;
   register `ResolveEntityModule` in `app.module.ts`; add `resolveEntity` to `routesconfig.ts`.
2. **Add deps**: `fuzzball`, `double-metaphone`.
3. **Port the matcher**: move the scoring/normalization/tenant-group/address-ranking logic from
   journeys' `resolve-directory.helper.ts` into the service (or a `resolve-entity.engine.ts` helper
   it calls). Keep it pure/testable; `db` passed in.
4. **Add address selection + `resolution_status` derivation** (§6).
5. **Learned-alias store** (§7): pick storage option, migrate + `db2:codegen` if new table, wire
   read/write.
6. **Controller + Zod validator** (§5); ensure tenant/auth via middleware.
7. **Observability** (§8).
8. **Tests** (§9). Run `npm test`.
9. **Docs**: short README in the module + update this notebook's scratchpad. In the PR, list the
   out-of-scope consumer tickets (§3).

---

## 11. Non-negotiables (review gate)

- Deterministic; no LLM in resolution.
- Never returns a guessed single entity/address when ambiguous.
- One authoritative `resolution_status`.
- Tenant scoping correct (group for entity search; requesting tenant for address).
- Read-only unless `confirm_match`.
- Matches core-node conventions (Zod, `req.tenantDb`, `db`-first services, route prefix, response
  interceptor).

---

## 12. References

- Product requirements (original): `PRD-resolve-entity.md` v1.0
- Critiques: `notes/06-opus-critique.md`, `notes/07-codex-critique.md`
- Gap research: `notes/05-implementation-research.md`
- Entity model + scenarios: `notes/01-entity-model.md`, `notes/03-ambiguity-scenarios.md`
- **Reference algorithm (port this):** `journeys/src/server-actions/api/directory/resolve-directory.helper.ts`
- core-node conventions: `src/shipments/`, `src/users/`, `src/middleware/tenant.middleware.ts`,
  `src/utils/validation.pipe.ts`, `src/config/routesconfig.ts`, `src/database/tenantdb.d.ts`
- Guess paths to retire later (not here): journeys `provision.lookup-directory.data.ts` (`rows[0]`),
  email-worker `store.attachment.classification.ts` (`LIKE` first-hit)
