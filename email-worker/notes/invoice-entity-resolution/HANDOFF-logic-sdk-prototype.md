---
doc: prototype-handoff
feature: logic-sdk (entity-resolution = capability #1)
supersedes: HANDOFF-resolve-entity.md §2.1 + §4 transport/home (core-node HTTP API)
version: 1.0
date: 2026-06-07
status: ready-to-start (next session)
authors: Carlos Marquez (product), Opus (architecture)
---

# Prototype Handoff — Logic SDK (in-process), entity-resolution first

> **Start here next session.** This doc sets up the prototype. The resolution *logic* (engine
> port, contract, status derivation, learned-alias, scenarios, ACs) is still defined in
> `HANDOFF-resolve-entity.md` — only the **transport/home** changes here: from a core-node HTTP
> API to an **in-process SDK** that hosts import and call directly.

---

## 0. What changed and why

The earlier handoff put resolution behind a **core-node HTTP endpoint**. Reviewing core-node's
auth showed that is the wrong boundary for our consumers:

- core-node's tenant DB is selected by a **JWT** (`cliente` → `TCExi_Clientes` → per-tenant DB) +
  a `userId` for role scoping. That model assumes a **browser user/session**.
- The **email-worker has no user**. It already reads `TCExi_Clientes` directly and opens its own
  per-tenant MSSQL pool. Forcing it through core-node would mean minting/borrowing a JWT **per
  email account/tenant** just to tell core-node which DB to use — a DB the worker already knows.
- The resolver kernel is already a **pure function over an injected `db` + tenantId + signals**
  (`resolveDirectoryEntityForDb(db, tenantId, input)`). It needs **no auth of its own**.

**Decision:** ship resolution as an **in-process library** that the host imports and hands its
**existing** connection to. The host inherits its own auth/connection; no token dance, no network
hop. Surfaces (CLI, HTTP) become thin optional adapters over the same core — added later only for
non-Node / cross-network consumers.

See `notes/06-opus-critique.md` and the conversation log for the full reasoning.

---

## 1. The Logic SDK (bigger than entity resolution)

This is **not** a one-feature package. Build **`logic-sdk`** as the home for **general shared
capabilities** consumed across Logic's Node/TS programs (worker, journeys, future tools/agents).
Entity resolution is **capability #1**, not the whole thing.

Design principles:

- **In-process first.** Hosts `import` it and pass their own DB connection / context. The SDK
  inherits whatever auth the running program already has.
- **Pure over an injected executor.** Capabilities are pure functions over an injected query
  executor + inputs — **not** welded to one DB/query-builder, framework, or runtime.
- **Deterministic & auditable** where correctness matters (resolution decisions never guess).
- **Tree-shakeable.** A host depends only on the capabilities it uses.
- **Agent-friendly.** A thin CLI over the same core lets shell/autonomous agents call capabilities;
  in-process LLM tool-calls just call the functions.

---

## 2. Tooling: pnpm (not npm)

- **pnpm workspace.** `pnpm-workspace.yaml` + per-package `package.json`.
- Internal deps via the **`workspace:*`** protocol.
- Run/scope with **`pnpm --filter <pkg>`**; install once at the root.
- Match Node/TS versions used by the worker so in-process import is drop-in.
- Do **not** use `npm`/`npx` in scripts or docs for this work.

---

## 3. Two parallel tracks

Develop the SDK and prove it in the worker **at the same time**; they converge when the worker
imports the SDK package instead of a local copy.

### Track A — prove it in the worker

Goal: validate the "inherit the host's live connection, no token" thesis and the resolution
outcomes, end-to-end, against the real worker runtime.

- Call the entity-resolution capability from a worker prototype (inside an **activity**, never
  workflow code) using the worker's **existing** `getTenantInstance(tenantConfig)` pool.
- Confirm: zero new auth, pool reused, runs in-process.
- Check outcomes against the deterministic scenarios TC-1…TC-12 in `HANDOFF-resolve-entity.md` §10.
- Measure in-process latency on the extraction path.

### Track B — build the SDK

Goal: stand up `logic-sdk` with a clean core + the first capability.

- Scaffold the pnpm workspace (§4).
- `core`: the **executor boundary**, shared types/result envelope, config/tunables access, logging
  hooks.
- `entity-resolution`: port the kernel from
  `journeys/source/src/server-actions/api/directory/resolve-directory.helper.ts` (keep its logic;
  add address selection + `resolution_status` derivation + learned-alias lookup per the
  resolve-entity handoff §5–6).

**Convergence:** Track A swaps its local module for a `workspace:*` dependency on the Track B
package once the boundary is stable.

---

## 4. Proposed shape (prototype in po-lab)

Prototype lives in po-lab first; extract to a standalone repo (`logic-sdk`, future substrate)
once the shape is proven. Suggested layout:

```
logic-sdk/                      # pnpm workspace (prototype dir in po-lab; later its own repo)
├── pnpm-workspace.yaml
├── package.json                # root: scripts, shared devDeps
└── packages/
    ├── core/                   # @logic/sdk-core
    │   ├── executor.ts         # the injected query-executor port (see §5)
    │   ├── result.ts           # shared result/envelope + error types
    │   ├── config.ts           # access to DB-resident tunables (thresholds, flags)
    │   └── logging.ts          # logging/metrics hooks (host supplies sink)
    └── entity-resolution/      # @logic/entity-resolution (capability #1)
        ├── normalize.ts        # diacritics, punctuation, legal-suffix strip
        ├── score.ts            # weighted scoring + fuzzy + double-metaphone
        ├── resolve.ts          # resolveEntity(executor, { tenantId, signals })
        ├── address.ts          # address selection + status derivation
        └── alias.ts            # learned-alias read (deterministic)
```

Open: single umbrella package (`@logic/sdk` with subpath exports) vs workspace-of-small-packages
(above). Recommendation: workspace-of-packages for tree-shaking + independent versioning; an
umbrella meta-package can re-export later. Prototype MAY start as one package and split.

---

## 5. The executor boundary (key decoupling)

Keep the SDK independent of any host's query builder/driver so it inherits the connection without
dragging Kysely/Tedious into every consumer.

- `core` defines a **narrow port**, e.g. a `query<T>(sql, params): Promise<T[]>` executor.
- Capabilities depend only on that port.
- Each host wraps its own connection in a thin adapter (e.g. `kyselyExecutor(db)` for worker +
  journeys, since both use Kysely today).

**Caveat to resolve in Track B:** the journeys kernel leans on Kysely's `sql` tagged template.
Either (a) port those queries to the raw executor, or (b) accept a Kysely instance via a
`@logic/entity-resolution-kysely` adapter package. Decide early; it shapes the boundary.

---

## 6. Capability #1 scope (entity-resolution)

Logic and contract are defined in `HANDOFF-resolve-entity.md`. For the prototype, pull forward:

- Engine port (normalization, weighted scoring, fuzzy + phonetic, tenant-group expansion,
  clear-winner gap rule, `confirm_match`).
- Address selection → `entity_address_id`, with `ambiguous_address` / `address_not_for_tenant`.
- `resolution_status` derivation (handoff §4.2 table).
- Learned-alias lookup as a deterministic first-class signal (handoff §6).
- `candidate_names` handling (misleading-PDF case resolved by extraction supplying alternatives,
  not by an agent).

Still **deterministic, never-guess**; LLM only at extraction time (signal harvesting), never as
the resolver.

---

## 7. Out of scope for the prototype

- Extracting `logic-sdk` into its own repo (do it after the shape is proven).
- CLI and HTTP adapters (design the core so they're trivial later; don't build now).
- DB migrations in production repos (`resolution_status` column, `directorio_resolved_alias`) —
  prototype against a dev/tenant DB; real migrations are a build-phase task.
- Retiring guess paths / provision gate in journeys — build-phase, after the SDK is real.

---

## 8. Open decisions for the prototype session

1. **Prototype location** in po-lab: standalone `po-lab/logic-sdk/` (it becomes its own
   substrate) vs under `email-worker/prototypes/`. Recommendation: standalone `po-lab/logic-sdk/`.
2. **Package granularity:** workspace-of-packages vs single umbrella package (§4).
3. **Executor boundary:** raw `query()` port vs accept-Kysely adapter (§5).
4. **Scope of "core":** which other shared capabilities are imminent (so `core` is shaped for
   them, not just resolution)?
5. **Versioning/distribution** for when it leaves po-lab: private pnpm registry vs git dependency.

---

## References

- Resolution logic/contract/ACs: `HANDOFF-resolve-entity.md`
- Architecture reasoning: `notes/06-opus-critique.md`, `notes/07-codex-critique.md`
- Gap research: `notes/05-implementation-research.md`
- Engine to port: `journeys/source/src/server-actions/api/directory/resolve-directory.helper.ts`
- Worker connection model: `email-worker/source/src/helper/{valid.tenants,tenant.connection}.ts`
- core-node auth (why not an API): `core-node/source/src/middleware/tenant.middleware.ts`
