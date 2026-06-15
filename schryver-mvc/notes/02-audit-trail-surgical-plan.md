# Schryver TMS — Audit-trail surgical plan (slice 1)

**Decision inputs (PO, 2026-06-12):** no triggers (deactivated for perf); new stack =
TypeScript on the **same MSSQL**; audit trail first, RBAC second.
**Constraint:** legacy stable, surgical, low-risk, fast. Backend + DB only.
**Control objectives served:** auditability, accountability, integrity (tamper-evidence).

---

## A. The problem the design must solve

Two write paths, neither auditable today:
- **EF writes** — 571 `SaveChanges()` sites, one shared `DbContext` (`Schryver_MVCEntities`),
  no existing override → a single clean choke point exists.
- **Stored-procedure writes** — 779 distinct SPs / 466 raw-SQL sites, and the **highest-risk
  cargo mutations run here** (`spp_BookingAsignaNuevoNumero`, `spp_CancelarBooking`,
  `spp_HawbAsignaNuevoId`, `spp_InsertaMawbConfirmada`, Dakosy declaration SPs, …).

Triggers (which would catch both transparently) are excluded. So completeness must come
from instrumenting **both** paths explicitly. The win: we only need the **risk-ranked
subset** (discovery §6) to be audit-complete, not all 8k tables — that keeps it surgical
and avoids the blanket-write overhead that burned the old trigger framework.

---

## B. Surgical options

### Option 1 — EF `SaveChanges` override only  *(chassis; necessary, not sufficient)*
Add a partial class on `Schryver_MVCEntities` overriding `SaveChanges()`; walk
`ChangeTracker.Entries()` for `Added/Modified/Deleted`, emit one `audit_log` row per entity
with a JSON field-diff, in the **same transaction** as the write.

- **Where:** new file `Models/Schryver_MVCEntities.Audit.cs` (partial; EDMX-safe, no regen).
  Actor from an ambient context (§D). Filter to an **allow-list of audited entity types**
  (the §6 cargo entities) so we don't log all 8k tables → bounded cost.
- **Effort:** ~1–2 days. **Risk:** low (additive, one transaction, allow-listed).
  **Rollback:** delete the partial file / clear the allow-list (kill-switch config flag).
- **Audit outcome:** complete for EF-path mutations to cargo entities. **Gap:** every SP
  mutation (incl. close/reopen booking, cancel, AWB id assignment) is invisible.

### Option 2 — Targeted application-boundary capture  *(closes SP gap, zero DB change)*
In each of the ~8 high-risk controller actions (§6), read the affected row(s) **before**
the SP call, read **after**, diff in C#, write `audit_log`. Works regardless of EF vs SP.

- **Effort:** ~0.5 day per action (~4–6 days for the set). **Risk:** low–medium (extra
  read; small race window — mitigate by wrapping read+SP+audit in one
  `TransactionScope`/serializable where the action isn't already transactional).
  **Rollback:** per-action, remove the capture call.
- **Audit outcome:** complete for the instrumented actions. **Downside:** manual, must be
  maintained as those actions change; double-read cost.

### Option 3 — In-SP audit INSERT for the high-risk procs  *(closes SP gap at the true write point)* ★
Add an explicit `INSERT INTO audit_log (...)` **inside** the specific high-risk stored
procedures — the old/new values are already in scope there. This is DB-layer but **not a
trigger**: it runs only for those few procs, no per-row/all-table overhead, fully
deterministic.

- **Where:** the ~8–12 SPs behind §6 (DBA-applied, version-controlled in the `databases`
  repo). **Effort:** ~3–5 days incl. DBA review/test. **Risk:** medium (editing prod SPs —
  but small, additive INSERTs; gated, reviewable, revert = redeploy prior proc body).
  **Rollback:** redeploy previous proc version.
- **Audit outcome:** most reliable SP-path capture; values captured exactly where written.

### Recommended combination — **Option 1 (chassis) + Option 3 (SP-path), Option 2 as fallback**
`SaveChanges` override gives broad EF coverage cheaply and is the portable contract.
In-SP inserts close the SP gap on exactly the security-relevant procs without
reintroducing trigger-style blanket cost. Use Option 2 only where editing an SP is judged
too risky. Net: the §6 risk-ranked actions become audit-complete; everything else can be
added later by extending the allow-list. **Explicitly logged: this scopes capture to the
risk-ranked set — non-cargo tables are not audited in slice 1 (stated, not silently
dropped).**

Export/download events (`GeneraPdfGuia*`, `DescargarAttach`) are **reads** → invisible to
any write hook; instrument those call sites directly with `action='EXPORT'` (Option 2 style).

---

## C. Schema — copy-paste DDL (T-SQL, MSSQL; identical for legacy & new stack)

```sql
-- Portable schema v1. Designed for: SQL Server (legacy Schryver_MVC on AWS RDS).
-- Migration target: SAME engine (SQL Server) in the new TypeScript stack — DDL is reused
--   verbatim; only the capture code is re-implemented in TS.
-- Do NOT add UPDATE/DELETE grants to audit_log for the application DB user (exischryver).
-- Append-only is enforced below via DENY. Retention/archival uses a SEPARATE login.

-------------------------------------------------------------------------------
-- 1) AUDIT LOG (append-only, one row per entity mutation or sensitive event)
-------------------------------------------------------------------------------
CREATE TABLE dbo.audit_log (
    id              BIGINT          IDENTITY(1,1) NOT NULL,
    occurred_at     DATETIME2(3)    NOT NULL CONSTRAINT DF_audit_log_occurred_at DEFAULT (SYSUTCDATETIME()),
    actor_id        INT             NULL,            -- TCSch_Usuario.cd_identityUsuario
    actor_email     NVARCHAR(256)   NULL,
    actor_country   INT             NULL,            -- cd_identityPaisUsuario (tenant scope)
    session_id      NVARCHAR(128)   NULL,
    ip_address      NVARCHAR(45)    NULL,            -- IPv4/IPv6
    correlation_id  NVARCHAR(64)    NULL,            -- per-request id (ties multi-row changes together)
    entity_type     NVARCHAR(128)   NOT NULL,        -- e.g. 'TESch_Booking','TESch_Hawb','TESch_ABDParticipante'
    entity_id       NVARCHAR(128)   NOT NULL,        -- PK as string; composite keys = JSON or 'k1|k2'
    action          VARCHAR(32)     NOT NULL,        -- see CHECK below
    changes         NVARCHAR(MAX)   NULL,            -- JSON: [{"field":"st_estatus","old":"A","new":"N"}, ...]
    old_value       NVARCHAR(MAX)   NULL,            -- for single-value / non-entity events
    new_value       NVARCHAR(MAX)   NULL,
    source_system   VARCHAR(64)     NOT NULL CONSTRAINT DF_audit_log_source DEFAULT ('legacy-tms'),
    metadata        NVARCHAR(MAX)   NULL,            -- JSON: {controller, action, http_method, url, sp_name, ...}
    prev_hash       CHAR(64)        NULL,            -- optional tamper-evidence chain (see note)
    row_hash        CHAR(64)        NULL,            --   SHA-256 over canonical row + prev_hash
    CONSTRAINT PK_audit_log PRIMARY KEY CLUSTERED (id),
    CONSTRAINT CK_audit_log_action CHECK (action IN
        ('CREATE','UPDATE','DELETE','EXPORT','LOGIN','LOGOUT','PERMISSION_CHANGE','READ_SENSITIVE')),
    CONSTRAINT CK_audit_log_changes_json CHECK (changes  IS NULL OR ISJSON(changes)  = 1),
    CONSTRAINT CK_audit_log_meta_json    CHECK (metadata IS NULL OR ISJSON(metadata) = 1)
);

-- Indexes for the three core audit queries:
CREATE INDEX IX_audit_log_entity   ON dbo.audit_log (entity_type, entity_id, occurred_at);  -- evidence pack per shipment
CREATE INDEX IX_audit_log_actor    ON dbo.audit_log (actor_id, occurred_at);                -- "what did user X do"
CREATE INDEX IX_audit_log_time     ON dbo.audit_log (occurred_at);                          -- time-range / retention
CREATE INDEX IX_audit_log_action   ON dbo.audit_log (action, occurred_at);                  -- by action class
CREATE INDEX IX_audit_log_corr     ON dbo.audit_log (correlation_id) WHERE correlation_id IS NOT NULL;

-------------------------------------------------------------------------------
-- 2) APPEND-ONLY ENFORCEMENT (the app login may only INSERT/SELECT)
--    DENY beats GRANT in SQL Server, so this holds even if a role grants more.
-------------------------------------------------------------------------------
GRANT  INSERT, SELECT ON dbo.audit_log TO [exischryver];
DENY   UPDATE, DELETE, ALTER          ON dbo.audit_log TO [exischryver];
-- Retention/archival must run as a separate, restricted maintenance principal (NOT exischryver).
```

**Recommendation — JSON diff, not EAV detail rows.** One `audit_log` row per mutation with
a `changes` JSON array is cheaper to write (matters given the perf history), trivially
portable to TS, and queryable via `OPENJSON`/`JSON_VALUE`. The legacy `AuditHeader`/
`AuditDetail` shape is the EAV alternative; we deliberately don't reuse it (it's tied to
the deactivated trigger framework).

**Tamper-evidence (NFR, optional in slice 1):** `prev_hash`/`row_hash` form a hash chain
(each row hashes its canonical content + the previous row's hash). With append-only DENY +
the chain, undetected edits/deletes require DB-admin collusion. Decide depth with the
auditor (see open items). Can ship without it and add later (columns are nullable).

> RBAC tables (`roles`, `permissions`, `user_roles`, `users` extension) are **slice 2** —
> DDL deferred to `03-rbac-plan.md` so slice 1 stays shippable. Audit captures
> `PERMISSION_CHANGE` already, so RBAC events become auditable when slice 2 lands.

---

## D. Actor-context bridge (legacy .NET)

The `SaveChanges` override can't see `SessionHelper` directly. Wire it once:

1. `AuditContext` = `{ actor_id, actor_email, actor_country, session_id, ip, correlation_id }`
   stored in an `AsyncLocal<AuditContext>` (request-scoped).
2. A global `IActionFilter` (registered at `App_Start/FilterConfig.cs`, alongside the
   existing filters) populates it from `SessionHelper` claims + `Request.UserHostAddress` +
   a generated `correlation_id` at `OnActionExecuting`.
3. `SaveChanges` override and the targeted capture/SP calls read the ambient `AuditContext`.
   For in-SP inserts, pass actor via a parameter or `SESSION_CONTEXT` set per request.

No controller edits required for the EF chassis. ~1 day.

---

## E. Portability contract (legacy → TypeScript, same MSSQL)

`audit_log` table = **reused verbatim**. Only the capture mechanism is re-implemented.
Define the event as the stable contract both systems emit:

```jsonc
// AuditEvent v1 — language-agnostic contract (JSON Schema, abridged)
{
  "occurred_at": "string (ISO-8601 UTC)",
  "actor":   { "id": "int|null", "email": "string|null", "country": "int|null" },
  "context": { "session_id": "string|null", "ip": "string|null", "correlation_id": "string|null",
               "source_system": "string", "metadata": "object|null" },
  "entity":  { "type": "string", "id": "string" },
  "action":  "CREATE|UPDATE|DELETE|EXPORT|LOGIN|LOGOUT|PERMISSION_CHANGE|READ_SENSITIVE",
  "changes": [ { "field": "string", "old": "any|null", "new": "any|null" } ]
}
```

| Legacy (.NET 4.8 / EF6) | New (TypeScript / same MSSQL) |
|---|---|
| `SaveChanges` override + `ChangeTracker` diff | ORM write interceptor (TypeORM `EntitySubscriber` / Prisma `$extends` / Knex hook) emitting the same `AuditEvent` |
| In-SP `INSERT INTO audit_log` for SP writes | port logic into services; if SPs survive, keep the in-SP insert (same table) |
| `IActionFilter` populates `AuditContext` | middleware (Express/Nest interceptor) populates request-scoped context |
| `audit_log` table (§C) | **same table, same DDL** |

**Reusable cross-system tests (same fixtures, both stacks):**
1. **Audit completeness** — for each §6 action, performing it produces exactly one
   `audit_log` row with correct `entity_type/entity_id/action/actor` and a non-empty
   `changes` for updates.
2. **Append-only** — `UPDATE`/`DELETE` on `audit_log` as the app login is rejected.
3. **Evidence pack** — given a `shipment_id`, the query in §F returns the full ordered
   change history (who/when/what) across Booking + linked HAWB/MAWB + Dakosy + documents.
4. (slice 2) **Authorization matrix** — role X cannot perform action Y on resource Z.

---

## F. Evidence pack (answering "who changed what, when" — no custom UI)

A parameterized query / stored proc, output to CSV/JSON for the auditor:

```sql
-- Full change history for one consignment and everything linked to it.
DECLARE @booking NVARCHAR(128) = @shipment_id;
SELECT occurred_at, actor_id, actor_email, action, entity_type, entity_id, changes, ip_address, correlation_id
FROM   dbo.audit_log
WHERE (entity_type = 'TESch_Booking' AND entity_id = @booking)
   OR  correlation_id IN (SELECT correlation_id FROM dbo.audit_log
                          WHERE entity_type='TESch_Booking' AND entity_id=@booking)
   OR (entity_type IN ('TESch_Hawb','TESch_Mawb','TESch_ABDDatosDeclaracion',
                       'TESch_ABDParticipante','TESch_DocumentoAsociado')
       AND entity_id IN (/* keys linked to this booking via existing FK lookups */))
ORDER BY occurred_at;
```
(Link-resolution uses existing FK relationships; finalize the joins once entity keys are
confirmed.) No log-viewer UI in slice 1 — a query + export meets the audit need.

---

## G. Minimal PRD — audit-trail slice (verifiable acceptance criteria)

**Scope:** tamper-evident change capture + evidence reporting for air-cargo-identifiable
records. RBAC and integrity-lock rules are out of this slice (sequenced next).

**AC-1 (capture, EF path):** Any create/update/delete of an audited entity
(`TESch_Booking`, `TESch_Hawb`, `TESch_Mawb`, `TESch_ABDDatosDeclaracion`,
`TESch_ABDParticipante`, `TESch_DocumentoAsociado`) via EF produces exactly one
`audit_log` row in the same DB transaction, with actor, timestamp, entity_type/id, action,
and a `changes` diff for updates. If the write rolls back, no audit row persists.

**AC-2 (capture, SP path):** Each §6 SP-driven action
(`CerrarBook`/`ReabrirBook`, `CancelarBook`, AWB enable/disable, Dakosy
`GuardaDeclaracion`/`GuardaParticipante`, MAWB reservation) produces an `audit_log` row
capturing the security-relevant field changes (e.g. `st_cerrado*`, `st_estatus`, EORI,
declaration/transfer type).

**AC-3 (export capture):** `GeneraPdfGuiaHouse/Master` and `DescargarAttach` each produce
an `audit_log` row with `action='EXPORT'`, the document/AWB id, and the actor.

**AC-4 (attribution):** Every `audit_log` row written via the app has non-null `actor_id`
when a user session exists; system/batch actions use a reserved actor id and
`source_system` value.

**AC-5 (append-only):** An attempt to `UPDATE` or `DELETE` `audit_log` using the
application DB login fails. Verified by automated test.

**AC-6 (evidence pack):** Given a `cd_noBooking`+year, the evidence query returns the
complete ordered change history across the booking and its linked HAWB/MAWB/Dakosy/document
records, exportable as CSV/JSON.

**AC-7 (performance):** Audit capture adds ≤ X ms p95 to an audited write and creates no
new full-table scans (bounded by the allow-list; indexed reads only). *(Set X with PO —
the old framework failed here; this design is allow-listed + single-row-per-mutation to
avoid that.)*

**AC-8 (kill-switch):** Audit capture can be disabled via config without redeploy, and the
write path continues to function with capture off.

**Non-functional / to confirm with security program & auditor:**
- Retention period for `audit_log` (and archival mechanism via the separate maintenance login).
- Tamper-evidence depth required (append-only DENY only, vs + hash-chain, vs + off-box
  WORM/log shipping).
- Backup coverage / restore test for `audit_log`.
- Query-performance SLA for evidence packs.

**Assumptions / unknowns:**
- Actor identity is reliably present at every audited action (true for UI flows; confirm
  for any batch/integration writers that bypass `SessionHelper`).
- The §6 list is the agreed audit scope for slice 1 (confirm with auditor that
  cargo-identity + security-status + export coverage is sufficient).
- Our formal secure-supply-chain status (reglementierter Beauftragter / bekannter Versender)
  and the specific obligations the auditor will test — confirm to validate scope.
```
