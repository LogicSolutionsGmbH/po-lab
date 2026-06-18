# Credential store — cross-examination

> Contrasts two independent answers to the 2026-06-01 Heroes credential-storage problem:
> **(A)** the provider-neutral research in `credential-store-encryption-research.md`, and
> **(B)** a colleague's Heroes design doc *"Heroes credential store — design"* (n8n-style
> encrypted store, native Postgres + Drizzle + Node crypto, Vault-custodied KEK, anomaly
> responder).
>
> Both are checked against the real code: `logic-heroes` `main` @ `fc98d87` (2026-06-18),
> pulled to `heroes/source/`. Line/file references below are from that tree.

## Verdict

The two approaches **agree on the load-bearing decision** — envelope encryption, DEK-per-row
wrapped by a versioned KEK, cheap re-wrap rotation. That foundation is sound and
code-feasible. The real debate is **two engineering forks** (where the KEK lives at runtime;
cryptographic vs app-layer tenant isolation) and **one factual correction** to the colleague's
refactor plan (the `service_participants` resolution path does not exist in the schema).

## 1. Where they converge (and the code agrees)

| Point | Research (A) | Colleague (B) | Code check @ `fc98d87` |
|---|---|---|---|
| Envelope: DEK-per-row wrapped by KEK | ✅ the recipe | ✅ `wrappedDek`/`encryptedData` rows | Greenfield — **no `credentials` table, no crypto module** exists yet |
| Rotation = re-wrap DEKs, never touch plaintext | ✅ verified | ✅ "rotation is cheap" | n/a (new) — claim is correct per vendor docs |
| `keyVersion` per row | ✅ | ✅ maps to Vault kv-v2 version | n/a (new) |
| Crypto module beside cache / rate-limiter | — | ✅ `packages/infrastructure` | ✅ `packages/infrastructure/src/{cache,rate-limiter}` exist — placement is real |
| Native DB store (not k8s secret layer, not live n8n) | ✅ resolves an open Q | ✅ Decision #5 (approach A) | ✅ correct call — UI + per-tenant + call-time resolution rule out the secret layer |
| Maersk = one OAuth client per consumer key | — | ✅ factory per credential | ✅ `maersk-auth.ts`: `Consumer-Key` is an `extraHeaders` value on `OAuth2ClientCredentialsService` — token **is** key-scoped |
| Today: one global env-based Maersk singleton | ✅ premise | ✅ premise | ✅ `MaerskAuthService` is a `static instance` singleton, `initializeFromEnv()` from `MAERSK_*` |
| Settings plaintext / secrets encrypted | ✅ | ✅ | aligns with call decision |

So B is a faithful, well-structured instantiation of the recipe A independently arrived at.
Convergence from two directions is strong evidence the foundation is right.

## 2. Factual correction — the Maersk resolution path (B is wrong about current schema)

B's "Consumption refactor" describes resolution as:

> `provider_subscription` → `provider_subscription_services` → each service's assignee tenant
> (`service_participants` where `role='assignee'`, **formerly the retired scalar
> `service.assigned_tenant_id`**) → `resolve('maersk', assigneeTenantId)`

and hedges with a ⚠️ to "confirm the exact assignee field… the scalar→m2m
`service_participants` migration changed it."

**That migration has not happened and is not planned.** In `source/` @ `fc98d87`:
- There is **no `service_participants` table** anywhere in `packages/database/src`.
- `service.assignedTenantId` (`service.assigned_tenant_id`) is a **live scalar FK** to
  `tenant.id`, actively written by the handshake/strategy flow
  (`packages/services/src/journeys/strategies/registry.ts`: side-effect
  `setAssignedTenant: 'target'` writes `service.assigned_tenant_id`).
- The asset-centric-milestones spec is explicit: *"No new junction table for this project…
  the only participant Heroes needs — the carrier — already lives on
  `service.assignedTenantId`."* If a junction is ever needed it would be
  `asset_tenant(asset_id, tenant_id, role)`, **not** `service_participants`.

**Consequence:** resolution is *simpler* than B feared — `service.assignedTenantId` →
carrier tenant → `resolve('maersk', assignedTenantId)`. Drop the `service_participants`
plumbing from the plan.

### 2a. There is already a tenant-level gate B doesn't account for
The carrier-routing model **already keys off the tenant**: `tenant.pipelineEnabled` decides
direct pipeline (Maersk / Hapag / MSC / CMA CGM) vs **Wakeo fallback**, and `tenant.providerCode`
holds the SCAC (`apps/api/src/modules/journeys/routes/visibility.ts`, asset-centric-milestones
spec). B's "no Maersk credential → Wakeo fallback" is a **second, different axis** from
`pipelineEnabled` (one asks *is this carrier on a direct pipeline*, the other *do we hold a
key*). They must **compose**, not collide — e.g. `pipelineEnabled=true` **and** a resolvable
credential ⇒ direct; otherwise Wakeo. Spell this out, or you get carriers flagged for direct
pipeline that silently fall back because no key was entered (or worse, the reverse).

## 3. Fork 1 — KEK in app memory (B) vs Vault Transit (A)

B uses Vault as a **key store** (kv-v2): fetch the KEK at boot, cache it in pod memory, do
all crypto in-app with Node `crypto`. A's purpose-built option is **Vault Transit**: the KEK
never leaves Vault; the app sends wrapped DEKs to Vault to unwrap.

The trade-off B states only implicitly:
- **B's crypto defends "stolen DB backup," not "compromised running pod."** A live pod holds
  the DB connection **and** the KEK in memory, so the "two halves are useless apart"
  guarantee covers at-rest theft only. That residual risk is **exactly why B needs the
  anomaly-detection subsystem** — it is a compensating control for a readable in-memory KEK.
- **Transit shrinks the blast radius.** With Transit + short-TTL caching of *unwrapped DEKs*,
  a memory dump leaks a few cached DEKs, not the master KEK that unlocks every tenant. Much
  of B's bespoke "monitor KEK reads → auto-rotate" machinery becomes unnecessary, because
  Vault's audit device already logs every key *use* and the key is never exfiltratable.
- B's counter is legitimate: it lists "per-decrypt KMS unwrap on every call" as YAGNI for
  latency. But **Transit-with-DEK-caching** gets most of the safety without per-call latency
  — the honest comparison is *that*, not naive per-call Transit.

**This is the decision to actually have at the reconvene:** is the custom anomaly responder
cheaper and safer than letting Transit hold the key? (Note: B already mandates Vault, so
Transit is incremental, not a new dependency.)

## 4. Fork 2 — app-layer vs cryptographic tenant isolation

B uses **one master KEK for all tenants**; isolation is the new `credential` permission
resource + middleware (a real, idiomatic pattern — `packages/permissions` is bitmask
`resource:CRUD`, easy to extend). So isolation is **application-layer, not cryptographic**:
one KEK compromise exposes every tenant, and there is no per-tenant crypto-shred.

That's a defensible trade — it dodges the KMS key-sprawl / rate-limit problem A flagged at
~200 integrations (today there are **8** trigger providers: hapag, vesselfinder, msc, maersk,
cma, traxon, wakeo, cargoproduce — so the 200 is a roadmap, not current). But make it
*knowingly*, especially against Valeriy's ISO-style bar:
- If the standard demands per-tenant key separation or crypto-shred for erasure, single-KEK
  won't clear it.
- **Cheap hardening B is missing: bind `ownerTenantId + id` as GCM AAD** (additional
  authenticated data). B stores `iv`/`authTag` but the doc shows no AAD. Without it, a DB
  writer could swap one row's ciphertext into another row/tenant and it would still decrypt.
  AAD is free and closes that.

## 5. Risks in B worth pressing

1. **The anomaly responder's core assumption is shaky.** B asserts "pods only start on a
   deploy, never via autoscaling/crash by policy," making legit KEK reads == replica count
   inside a deploy window. But Kubernetes restarts pods on **liveness-probe failures,
   OOMKills, node drains, and evictions** regardless of autoscaling policy. Any involuntary
   disruption ⇒ a KEK read outside a window ⇒ **false-positive auto-rotate + auto-redeploy of
   production.** Auto-remediation that powerful needs a human-confirm gate or a far more
   robust "expected read" model, or it becomes a self-inflicted-outage vector. This is the
   single riskiest part of B.
2. **No scheduled rotation.** B makes rotation event-driven only (schedule is YAGNI'd).
   Periodic rotation (e.g. annual) is usually a *baseline* compliance checkbox — relevant to
   the ISO framing. `keyVersion` reserves it, so it's cheap to add; just flag it's absent.
3. **Env fallback during migration is good — keep it explicitly time-boxed.** B's seed →
   global-default rows → env fallback → per-tenant split is the right dual-write sequence
   (matches A). Add: delete the fallback and the `MAERSK_*` env vars in the *same* PR as the
   singleton removal, so the fallback can't quietly become permanent.

## 6. What B gets right that the research (A) didn't cover

- **Vault over cloud KMS is the better call for Heroes' infra.** A defaulted to cloud KMS
  *"if you have one."* B supplies the missing context: Heroes is self-hosted European infra
  (Harbor `harbor.logicjourneys.dev`, Dagger/cosign, `promote-production.yml`), **not** a
  hyperscaler. Given that, Vault is correct and A's cloud-KMS default doesn't apply.
- **The credential-type registry + dynamic UI** is the concrete realization of the call's
  "UI where tenants provide their own keys," and it makes the other ~6 providers config-only.
  A never specified this.
- **The immutable-infra anomaly idea is genuinely novel thinking** — even with the caveat in
  §5.1, "treat any KEK read outside a deploy window as a breach signal" is a sharp use of the
  fixed-replica deployment model, and B states the honest "can't un-leak" caveat correctly.
- **Migration detail** (seed script, `resolve()` fallback, per-assignee split) is more
  concrete than A's sketch.

## 7. For the reconvene — the short list

1. **Correct the refactor plan:** resolution is `service.assignedTenantId` → carrier tenant.
   No `service_participants`. Define how the credential check **composes** with the existing
   `tenant.pipelineEnabled` Wakeo-fallback gate.
2. **Decide Fork 1:** KEK-in-memory + custom anomaly responder **vs** Vault **Transit**
   holding the key (Vault is already in the plan either way).
3. **Decide Fork 2:** single KEK (app-layer isolation) vs per-tenant keys (cryptographic).
   Either way, **add tenant-bound GCM AAD** now — it's free.
4. **De-risk the responder:** gate auto-rotate/redeploy on human confirm, or harden the
   "expected read" model against involuntary pod restarts before shipping Phase 5.
5. **Add scheduled rotation** as a baseline control (cheap given `keyVersion`).
6. **Sequence by revenue:** Maersk consumer key first (the live ~20–30% subscription blocker);
   bearer token stays fetched-fresh, never stored.

---
*Sources: `heroes/source/` @ `fc98d87`; research deliverable
`credential-store-encryption-research.md`; colleague design doc "Heroes credential store —
design" (2026-06-01 brainstorm).*
