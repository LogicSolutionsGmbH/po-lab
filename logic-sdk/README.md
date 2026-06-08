# logic-sdk (prototype)

In-process shared capabilities for Logic's Node/TS programs. A host `import`s a capability and
passes its **own live DB connection**; the SDK inherits the host's auth/connection — no token, no
network hop. **Entity resolution is capability #1.**

> Prototype lives in po-lab; extracted to its own repo once the shape proves out.
> Design decisions: `../email-worker/notes/invoice-entity-resolution/scratchpad.md`
> (grill session 2026-06-07/08) + `HANDOFF-logic-sdk-prototype.md` / `HANDOFF-resolve-entity.md`.

## Layout

```
logic-sdk/                      # pnpm workspace
└── packages/
    └── entity-resolution/      # @logic/entity-resolution (capability #1)
        └── src/
            ├── core/           # executor boundary, flat contract, errors, config, logging
            ├── engine/         # ported deterministic matcher (journeys kernel)
            ├── alias.ts        # learned-alias DB read (deterministic short-circuit)
            ├── address.ts      # address selection + resolution_status derivation
            ├── resolve.ts      # resolveEntity() — the pure capability
            ├── index.ts
            └── harness/        # Track A runner (TC-1…TC-12 vs a real dev tenant DB)
```

## Key decisions baked in (grill session)

- **Executor boundary = Kysely.** The capability accepts a `Kysely` instance. Raw `query()` port deferred.
- **Flat §4.2 contract** via a thin mapping layer over the *unchanged* matcher kernel.
- **Pure function**, no module-level singletons; thresholds are injectable config (hardcoded defaults).
- **Learned alias = read-only DB** (`directorio_resolved_alias`); the kernel's in-memory cache was dropped.
- **candidate_names = wrapper best-of** with an ambiguity guard (differing entities → `ambiguous_entity`).
- **Failure semantics**: infra errors throw `ResolutionInfraError`; business outcomes are returned, never thrown.

## Usage (in-process)

```ts
import { resolveEntity } from '@logic/entity-resolution';

const result = await resolveEntity(db /* host's Kysely pool */, {
  tenantId: cdIdentityDatosRFC,   // = TESch_FacturaExtraida.cd_identityTenant (invoice recipient)
  signals: { entity_name, tax_id, eori, country_code, city, candidate_names },
});
// result.resolution_status ∈ resolved | ambiguous_entity | ambiguous_address | address_not_for_tenant | not_found
```

## Run the Track A harness

Requires Node ≥ 20 and pnpm (via corepack: `corepack prepare pnpm@9.15.4 --activate`).

```bash
pnpm install
cp .env.example .env          # fill in: dev tenant DB + SDK_DIRECTORY_TENANT_ID (cd_identityDatosRFC)
pnpm --filter @logic/entity-resolution harness
```

The harness runs TC-1…TC-12 against the dev tenant DB and asserts `resolution_status`. Scenario
signal values and several seeded rows are **PLACEHOLDERS** — fill them for the chosen tenant
(see `src/harness/scenarios.ts`).

## Scripts

- `pnpm --filter @logic/entity-resolution typecheck`
- `pnpm --filter @logic/entity-resolution build`
- `pnpm --filter @logic/entity-resolution harness`

## Out of prototype scope (build phase)

Standalone repo extraction; CLI/HTTP adapters; DB migrations (`resolution_status` column,
`directorio_resolved_alias`); Participantes upsert + provision gate; alias write-back; recipient →
`cd_identityTenant` worker activity; retiring guess paths.
