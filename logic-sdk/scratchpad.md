# logic-sdk — scratchpad

## Scope
Prototype of the Logic SDK (in-process shared capabilities). Capability #1 = entity-resolution.
Built per the grill-session decisions recorded in
`../email-worker/notes/invoice-entity-resolution/scratchpad.md` (2026-06-07/08).

## Done (2026-06-08)
- Scaffolded pnpm workspace: `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`,
  `.gitignore`, `.env.example` (placeholder DB + `SDK_DIRECTORY_TENANT_ID`).
- Single package `@logic/entity-resolution` (`core` + `engine` + capability as internal folders).
- **core/**: `executor.ts` (Kysely boundary), `result.ts` (flat §4.2 contract), `errors.ts`
  (`ResolutionInfraError`), `config.ts` (default profile, injectable), `logging.ts` (Logger + §9
  observation).
- **engine/**: ported journeys kernel to `Kysely<any>` — `normalize.ts`, `scoring.ts` (in-memory
  AliasCache REMOVED → pure), `queries.ts` (SQL verbatim; infra errors wrapped), `resolver.ts`
  (orchestration → internal entity profile; `memorizeSignals` removed).
- **SDK layer**: `alias.ts` (read-only `directorio_resolved_alias` lookup, tolerant if unseeded),
  `address.ts` (address selection + `resolution_status` derivation = the NEW logic),
  `resolve.ts` (pure `resolveEntity`: alias short-circuit → candidate_names best-of → matcher →
  flat-contract mapping → §9 observation; typed-throw failure semantics), `index.ts`.
- **harness/**: `config.ts` (env + placeholder guard), `connection.ts` (knex mssql +
  kysely-knex, mirrors worker), `scenarios.ts` (TC-1…TC-12, placeholders + seed flags),
  `run.ts` (asserts resolution_status, prints pass/fail + p50/p95).
- **Verified**: `pnpm install` (pnpm 9.15.4 via corepack; node 20), `tsc --noEmit` clean,
  `tsc --build` emits declarations, harness executes and fails gracefully on placeholder env.

## Open / needs Carlos
- Fill `.env` (dev/staging tenant DB) + `SDK_DIRECTORY_TENANT_ID` (= `cd_identityDatosRFC`).
- Fill placeholder signals in `src/harness/scenarios.ts` for the chosen tenant; seed rows for
  TC-4/5/7/8/10 (incl. a `directorio_resolved_alias` row for TC-10).
- Run the suite; pin expected `resolution_status` per scenario against real data.

## Assumptions
- `directorio_resolved_alias` schema is a PLACEHOLDER (tenant_id, normalized_signal, entity_id,
  entity_address_id, status, confirmed_at) — align to the real migration when it lands.
- `Kysely<any>` executor avoids dragging any host's generated `tenantdb` schema (raw `sql` queries
  don't need it).
- Node 20 dev machine (worker targets 22; `engines` relaxed to >=20 for the prototype).

## Build-phase (out of scope here)
Repo extraction; CLI/HTTP adapters; DB migrations; Participantes upsert + provision gate; alias
write-back; recipient→`cd_identityTenant` worker activity; retire guess paths.

## Links
- ../email-worker/notes/invoice-entity-resolution/scratchpad.md (decisions)
- ../email-worker/notes/invoice-entity-resolution/HANDOFF-logic-sdk-prototype.md
- ../email-worker/notes/invoice-entity-resolution/HANDOFF-resolve-entity.md
- README.md
