# Schryver TMS — LBA audit-posture discovery (Phase 1)

**Substrate:** `schryver-mvc/source` @ `master` `fbe1cb598`
**Date:** 2026-06-12
**Scope:** discovery + decision support for LBA-relevant audit posture (auditability,
accountability, integrity, least privilege) in the **legacy** TMS, designed to port into
the new stack. Backend + DB layer only.

---

## 1. Tech stack (as found)

| Concern | Finding | Evidence |
|---|---|---|
| Framework | ASP.NET **MVC 5.3**, **.NET Framework 4.8** | `packages.config`, `SchryverMVC.csproj` |
| ORM | **Entity Framework 6.5**, **database-first EDMX** (`Models.SchryverMVC.*`), generated as **`DbContext`** (not ObjectContext) | `Models/SchryverMVC.Context.cs:19` `public partial class Schryver_MVCEntities : DbContext`; `OnModelCreating` throws `UnintentionalCodeFirstException` |
| DB | **SQL Server** on **AWS RDS**, catalog `Schryver_MVC`, single app login `exischryver` | `Web.config:28,711` (⚠ plaintext creds in repo) |
| Auth | **Forms auth** (cookie, 120-min sliding) backed by an **external REST auth API** returning a **JWT**; JWT decoded **without signature verification** | `Web.config:399`; `AccountController.cs:104-117,247`; `SessionHelper.cs:125 DoNotVerifySignature()` |
| Identity in-process | `cd_identityUsuario`, `cd_identityPaisUsuario` (tenant) read from JWT claims via `SessionHelper.GetClaim<T>()` on every action | `SessionHelper.cs:75-98`; e.g. `DakosyController.cs:18-33` |
| Logging | **log4net → SQL Server** (`AdoNetAppender` → `spp_LogGeneralInserta` → `TESch_LogGeneral`), **errors/exceptions only** | `Web.config:21-122`; `Log4NetController.cs:11,37-44` |
| Telemetry | App Insights / Azure Monitor OTel packages **present but not wired** | `packages.config`; no `ApplicationInsights.config`, no `TelemetryClient` usage |
| Doc storage | **AWS S3**, uploads written with **`S3CannedACL.PublicRead`** | `AdministradorDeArchivosController.cs:64` |
| Frontend | Razor + jQuery + Knockout (out of scope) | `Views/`, `Scripts/` |

Deployment: in-proc session (`Web.config:390`, single-server affinity), GitHub-Actions
self-hosted runners per client/environment (`df`/README runner docs).

---

## 2. The decisive finding — a dormant DB-trigger audit framework already exists

The EDMX already maps a **complete generic SQL-Server audit framework** that **no
application code writes to or reads from**:

| Entity | Role | Key columns |
|---|---|---|
| `AuditBaseTable` | per-table audit config | `SchemaName`, `TableName`, `LogInsert/LogUpdate/LogDelete` (byte), `StrictUserContext`, `LogSQL`, `EnabledFlag`, `ColumnNames` |
| `AuditHeader` | one row per mutation | `AuditDate`, `HostName`, `SysUser`, `Application`, `TableName`, `Operation`, `SQLStatement`, `PrimaryKey`..`PrimaryKey5`, `RowVersion` |
| `AuditDetail` | one row per changed column | `ColumnName`, `OldValue`, `NewValue`, FK→`AuditHeader` |
| `SchemaAudit` | DDL audit | `LoginName`, `UserName`, `Event`, `TSQL`, `XMLEventData` |
| `AuditHeaderArchive` / `AuditDetailArchive` | retention/archive | mirror of above |
| `AuditSetting`, `AuditAllExclusion` | config | — |

Files: `Models/Audit{BaseTable,Header,Detail,Setting,AllExclusion}.cs`,
`Models/SchemaAudit.cs`, `Models/Audit{Header,Detail}Archive.cs` (all auto-generated →
**the tables physically exist in the legacy DB**).

This is the who / when / table / operation / PK / **per-column old→new** capture the LBA
brief asks us to build. It is trigger-driven (DDL/`SQLStatement`/`StrictUserContext`
semantics), so it captures **all** write paths, including stored procedures.

**What the repo cannot tell us (must validate against the live DB):**
1. Are the triggers actually deployed and `EnabledFlag=1` on the cargo tables, or is the
   framework installed-but-idle?
2. Does `AuditBaseTable` currently have any rows (is *anything* audited today)?
3. Are `AuditHeader/Detail` being populated now?
4. How is the app user mapped into `SysUser`/`Application`? — note the app rewrites the EF
   connection's Application Name to `ip_host_userId` (`SessionHelper.cs:158-164`), so
   `APP_NAME()` inside a trigger would already carry the app user id. `StrictUserContext`
   suggests the framework can require a user context (CONTEXT_INFO/SESSION_CONTEXT).

---

## 3. Why app-layer interception alone is insufficient

A single clean EF choke point exists: `Schryver_MVCEntities` is one partial `DbContext`,
**571** `SaveChanges()` sites in controllers, **no existing override** → a `SaveChanges`
override could capture `ChangeTracker.Entries()` old/new for all EF writes.

**But** the system is heavily stored-procedure-driven:

- **779** distinct `spp_/sps_` stored procedures referenced; **466** raw-SQL/SP exec sites.
- The security-relevant cargo mutations themselves run through SPs an EF hook can't see:
  `spp_HawbAsignaNuevoId`, `spp_BookingAsignaNuevoNumero`, `spp_CancelarBooking`,
  `spp_InsertaMawbConfirmada`, `spp_SincronizarDetalleCarga`, `spp_ValidaBookingCierre`…

→ **An EF `SaveChanges` hook would silently miss the highest-risk mutations.** Only
**DB-level** capture (the existing trigger framework) is complete. This is the core
architectural conclusion.

---

## 4. Auth / authorization posture

- **Authentication:** present (Forms + external JWT). Actor identity **is** reachable
  in-process at every mutation point.
- **Authorization:** effectively **absent**. Global filter is a bare
  `new AuthorizeAttribute()` (`FilterConfig.cs:15`) — authenticated-or-not, **no roles**.
- Role tables **exist but are dead**: `TCSch_RolUsuario`, `TRSch_UsuarioRoles`,
  `TCSch_Usuario.cd_identityRolUsuario` are never consulted for access decisions
  (`Global.asax.cs:73` comment confirms). Zero `[Authorize(Roles=…)]`, zero `IsInRole`.
- The only real check is **view/menu visibility** via `TRSch_AccsesoUsuario` → `TCSch_SubMenu`
  (`CustomAuthorizeAttribute`, `UtileriasController.cs:475-527`) — rarely applied, and it
  gates **menu items, not actions/data**.
- ⚠ Passwords stored **plaintext** (`TCSch_Usuario.tx_contrasena`; `AccountController.cs:355`).

**Choke point to add RBAC:** a single `AuthorizeAttribute` subclass swapped in at
`FilterConfig.cs:15`, or a `BaseController.OnActionExecuting`, mapping
controller/action → required permission, checked against new role/permission tables.

---

## 5. Logging / attribution gaps (what we can prove today)

| Question | Today |
|---|---|
| WHO changed a record on the **success** path | ❌ not recorded (only exceptions are logged) |
| WHAT changed (old→new) | ❌ none at app layer (✅ *possible* via dormant `AuditDetail` if triggers active) |
| WHEN | ⚠ only for errors (`TESch_LogGeneral.fh_utcProceso`) |
| FROM WHERE (client IP) | ❌ never captured |
| Correlation id / request id | ❌ none |
| Identity available in-process to stamp | ✅ `cd_identityUsuario` via `SessionHelper` |

Function-specific "bitácoras" exist (`TESch_BitacoraDeclaracionABD`,
`TESch_BitacoraBookingDelegado`, `TESch_ProcesoBillOfLadingBitacora`…) but are
operation-scoped, not general change capture. `AuditoriaClausuraController` is an
**accounting period-close lock**, *not* a data-change audit.

---

## 6. Risk-ranked air-cargo-identifiable actions (LBA-relevant)

Identifiable air-cargo entities: `TESch_Booking` (consignment), `TESch_Hawb` (HAWB),
`TESch_Mawb` (MAWB), Dakosy `TESch_ABD*` (German customs/e-AWB declaration), document
attachments. Highest audit priority first:

| # | Action (file:line) | Entity / fields | Why it matters |
|---|---|---|---|
| 1 | `BookController.CerrarBook:1007` / `ReabrirBook:1079` | `TESch_Booking.st_cerrado*` lock/unlock | Re-open reverses a finalized consignment → post-clearance edits to shipper/cargo |
| 2 | `DakosyController.GuardaDeclaracion:1359` / `GuardaParticipante:1424` | `TESch_ABDDatosDeclaracion`, `TESch_ABDParticipante` (`cd_EORI`, declaration/transfer type, participant roles) | Sets identity/classification transmitted to German customs (Zoll) |
| 3 | `BookController.ModificarBook:275` | `TESch_Booking` shipper/consignee/agent identity, `tp_peligroso`, description, weights | Changes consignment identity & DG status with no field-level trail |
| 4 | `GuiaAereaController.ModificarGuiaAereaHouse:663` / `GuardaNueva…:407` | `TESch_Hawb` shipper/consignee, `st_estatusConfirmaEnvio`, declared values | AWB-level cargo identity & dispatch authorization |
| 5 | `GuiaAereaController.Deshabilita{House:880,Master:2149}` | `st_estatus`→N, unlinks tramos | Cancels/erases cargo from active tracking |
| 6 | `ReservacionMawbController.GuardaReservas:81` | `TESch_Mawb.st_guiaOcupada` | MAWB reservation/availability |
| 7 | Exports: `GeneraPdfGuia{House:1496,Master:2193}`, `AttachController.DescargarAttach:134` | full AWB PDF / S3 doc download | Disclosure of identifiable cargo info; **no download audit**; ⚠ **S3 PublicRead** |
| 8 | `AttachController.EditarAttach:190`, `DirectorioDocumento.eliminaDocumento:179` | `st_activo`→N | Hides supporting documents from the trail |

---

## 7. Architecture options (decision required)

**Option A — Activate the existing DB-trigger audit framework** for the cargo tables.
*Set `AuditBaseTable` rows + ensure triggers deployed; bridge app user via `APP_NAME()`/
`SESSION_CONTEXT`.* **+** complete (catches SP + raw SQL), DB-enforced append-only, almost
no app code, framework already present. **−** SQL-Server-specific (port = reimplement as
new-stack equivalent), needs DBA, attribution depends on user-context bridge.

**Option B — App-layer EF `SaveChanges` override** (partial class on `Schryver_MVCEntities`).
**+** clean portable C# contract, rich request context (IP, correlation id, session).
**−** **blind to 779 SPs / 466 raw-SQL sites** incl. the top cargo mutations → incomplete →
not defensible as *the* integrity control.

**Option C — Hybrid (recommended):** Option A as the **integrity-grade system of record**
for cargo tables (completeness + DB-enforced append-only), plus a thin app-layer enricher
that stamps **actor / session / IP / correlation_id** into the DB user-context per request
so trigger rows are fully attributable, and that captures **export/download** events
(which are reads, invisible to write triggers). Define the portable `AuditEvent` /
`RolePolicy` contracts once; legacy realizes them via triggers+enricher, new stack via an
append-only store + policy engine.

→ Recommendation: **C**, contingent on confirming the framework is live (validation #1-4 in §2).

**DECISION (2026-06-12, from PO):** Triggers are **OUT** — the framework in §2 was
deliberately **deactivated long ago for performance reasons**; PO prefers no triggers.
New stack = **TypeScript on the same MSSQL**. Sequence = **audit trail first**, RBAC next.
→ Revised architecture in `02-audit-trail-surgical-plan.md`: app-layer `SaveChanges`
override (chassis) + **targeted in-SP audit inserts** for the handful of SP-driven
high-risk actions (NOT blanket triggers). Same-MSSQL means the `audit_log` DDL is
identical across legacy and new stack — only the capture code is re-implemented in TS.

---

## 8. Open items to validate (fast)

- DBA: is `AuditBaseTable`/`AuditHeader` live and populated? which tables? (4 SELECTs)
- Confirm `APP_NAME()`/connection-app-name path actually reaches triggers as user id.
- Security program: our formal secure-supply-chain status (reglementierter Beauftragter /
  bekannter Versender?), the auditor, required **retention** & **tamper-evidence** level.
- New-stack target (DB + language) to lock the portable contract.

*Next deliverables (not yet written): surgical options w/ effort+rollback, copy-paste DDL
(audit_log + roles/permissions/user_roles), portability contracts, minimal PRD.*
