# PRD — Schryver TMS Audit Trail (slice 1)

**Status:** draft for review · **Owner:** dev-1@logic.fyi · **Acceptance authority:** Stefan Reuter
**Date:** 2026-06-16 · **Supersedes the "Minimal PRD" in** `02-audit-trail-surgical-plan.md` §G
**Decision record:** ADR 0001 (audit-all/no-mode-filter), ADR 0002 (app-boundary SP capture),
ADR 0003 (append-only is mitigation-not-guarantee)

---

## 1. Why this exists (context)

Schryver wants to stop running air-cargo operations on **Cargosoft** and run them on **Logic's
TMS** (the legacy .NET Schryver MVC app today; a TypeScript rewrite in progress). As a
participant in the secure air-cargo supply chain, Logic's TMS **may not carry regulated
air-cargo operations unless it can prove who changed what, when** to identifiable cargo data,
and protect that data against tampering. Today it cannot: success-path changes are not
recorded, there is no field-level history, no client IP, no correlation id, and the only
historical capture (a trigger-driven audit framework) was deliberately deactivated for
performance and is dead.

This is a **go-live gating compliance feature**, not a response to a scheduled audit — though
we assume an LBA inspection *will* happen, so the controls must be genuine, not theatre.

**Regulatory anchors** (LBA = Luftfahrt-Bundesamt): VO (EG) 300/2008 + DVO (EU) 2015/1998
(esp. **§6.4.2.1** — protect identifiable air cargo *vor unbefugtem Zugriff oder Manipulation*)
+ LuftSiG. The *reglementierter Beauftragter* approval requires a security programme (LFSP)
that describes the methods/procedures **and how the agent monitors its own compliance** — the
audit trail is that monitoring evidence. Cargo identifiability arises partly from *elektronische
Begleitdokumente mit Angabe der Versandart* — i.e. the TMS data itself.

## 2. Goals & success metrics

**Primary (outcome):** Stefan Reuter can sign the internal document attesting LBA compliance,
because for any §6 action we can produce a complete, attributed, tamper-evident who/what/when
**evidence pack** on demand, and it would withstand an LBA inspection. Verified by a dry-run
evidence-pack review with Stefan — not by tests alone.

**Proxy (leading, gated at release):** 100% of §6 actions exercised in staging produce a
correct `audit_log` record (AC-1…AC-6 green). This is the release gate.

**Non-goal:** RBAC / authorization (slice 2). Audit captures `PERMISSION_CHANGE` so RBAC events
become auditable when slice 2 lands.

## 3. Scope

**In scope** — tamper-evident change capture + evidence reporting for the §6 risk-ranked
air-cargo actions, in the legacy .NET app, backend + DB only:

| # | Action | Entity / fields | Path |
|---|---|---|---|
| 1 | `CerrarBook` / `ReabrirBook` | `TESch_Booking.st_cerrado*` | SP |
| 2 | Dakosy `GuardaDeclaracion` / `GuardaParticipante` | `TESch_ABDDatosDeclaracion`, `TESch_ABDParticipante` (`cd_EORI`, declaration/transfer type, roles) | SP |
| 3 | `ModificarBook` | `TESch_Booking` shipper/consignee/agent, **`tp_movimiento*` (mode)**, `tp_peligroso`, description, weights | EF/SP |
| 4 | `ModificarGuiaAereaHouse` / `GuardaNueva…` | `TESch_Hawb` shipper/consignee, `st_estatusConfirmaEnvio`, declared values | EF/SP |
| 5 | `Deshabilita{House,Master}` | `st_estatus`→N, unlinked tramos | SP |
| 6 | `ReservacionMawb.GuardaReservas` | `TESch_Mawb.st_guiaOcupada` | SP |
| 7 | Exports: `GeneraPdfGuia{House,Master}`, `DescargarAttach` | full AWB PDF / S3 doc download | read |
| 8 | `EditarAttach`, `eliminaDocumento` | `st_activo`→N | EF/SP |

Audited entities: `TESch_Booking`, `TESch_Hawb`, `TESch_Mawb`, `TESch_ABDDatosDeclaracion`,
`TESch_ABDParticipante`, `TESch_DocumentoAsociado`.

**Out of scope (stated, not silently dropped):**
- Non-cargo tables (the other ~8k) — not audited in slice 1; addable later by extending the allow-list.
- **Read/access logging beyond the disclosure boundary** — only exports/downloads are logged.
  Preventing unauthorized *access* is RBAC's job (slice 2). Rationale: the regulation asks us to
  *prevent* unauthorized access (a control), not to log every authorized read.
- RBAC / authorization rules — slice 2 (`04-rbac-plan.md`).
- Least-privilege re-architecture of the app DB login (Posture B) — see §7 / ADR 0003.

**Scope-completeness gate (pre-go-live):** Stefan validates that the §6 set maps onto the LBA
obligations he is attesting to, and names any obligation §6 does not cover. §6 is the
engineering floor; the allow-list makes adding a missed entity cheap.

## 4. Design summary

Slice 1 is **app-layer-only**; the sole DB change is creating `audit_log`.

- **EF path (chassis):** a partial class on `Schryver_MVCEntities` overrides `SaveChanges()`,
  walks `ChangeTracker.Entries()` for Added/Modified/Deleted on **allow-listed** entity types,
  and writes one `audit_log` row per entity (JSON field-diff) **in the same transaction**.
- **SP path:** **app-boundary capture** (ADR 0002) — read affected row(s) before the SP call,
  read after, diff in C#, write `audit_log`, wrapping read+SP+audit in a `TransactionScope`
  where accuracy needs it. **No production SP bodies are edited** (no DBA, no SP version control).
- **Exports:** instrument the call sites directly with `action='EXPORT'`.
- **No transport-mode filter:** all `TESch_Booking` writes are audited regardless of
  air/ocean/road; the `tp_movimiento*` fields are first-class audited fields (ADR 0001).

### Actor-context bridge (corrected)
A request-scoped `AuditContext` carries `{actor, session, ip, correlation_id}`. Correlation-id
and IP are seeded by a global `IActionFilter` at `OnActionExecuting`. The **actor is resolved
lazily at write time** from the ambient request-scoped `SessionHelper`, **not** snapshotted at
`OnActionExecuting` — because the integration ("Heroes") endpoints bind the JWT mid-action via
`SetToken(a)`, so an early snapshot would record a null actor. A reserved system-actor id is a
defensive fallback only.

## 5. Data model

`audit_log` DDL is per `02-audit-trail-surgical-plan.md` §C (reused verbatim; one append-only
row per mutation/sensitive event; JSON `changes` diff; `prev_hash`/`row_hash` hash-chain
columns; indexes for entity / actor / time / action / correlation queries). The same DDL is
reused verbatim by the TypeScript stack; only the capture code is re-implemented there
(`AuditEvent` v1 contract, §E of `02`).

## 6. Acceptance criteria

- **AC-1 (capture, EF path):** any create/update/delete of an audited entity via EF produces
  exactly one `audit_log` row **in the same transaction**, with actor, timestamp, entity_type/id,
  action, and a `changes` diff for updates. On rollback, no audit row persists.
- **AC-2 (capture, SP path):** each §6 SP-driven action produces an `audit_log` row capturing the
  security-relevant field changes (incl. `tp_movimiento*` mode changes on Booking).
- **AC-3 (export capture):** `GeneraPdfGuiaHouse/Master` and `DescargarAttach` each produce a row
  with `action='EXPORT'`, the document/AWB id, and the actor.
- **AC-4 (attribution):** every app-written row has a non-null actor when a session/token exists;
  the actor is resolved at write time (late-bound integration tokens included). System actions use
  the reserved actor id + `source_system`.
- **AC-5 (append-only, scoped honestly):** an `UPDATE`/`DELETE` on `audit_log` by a **lesser**
  login is rejected by `DENY`. This does **not** hold against the omnipotent app login — see §7.
- **AC-6 (evidence pack):** given `cd_noBooking`+year, the evidence query returns the complete
  ordered change history across the booking and its linked HAWB/MAWB/Dakosy/document records,
  exportable as CSV/JSON. No log-viewer UI in slice 1.
- **AC-7 (performance):** audit capture does not noticeably slow the audited actions (verified by
  running each §6 action in staging); capture reads use indexed lookups (no new full-table scans),
  writes are single-row inserts. The Option-2 double-read is the cost to watch.
- **AC-8 (config-gated, traceable):** audit capture is governed by versioned config; changes to it
  ship through GitHub Actions and are traceable in git history + CI logs. **There is no
  out-of-band runtime kill-switch** (deliberate — see §7).

## 7. Integrity posture & non-functional requirements

**Append-only is mitigation, not guarantee (ADR 0003).** The app login `exischryver` holds full
rights, so `DENY UPDATE/DELETE/ALTER` stops accidental writes, app bugs, and lesser logins, and
the hash-chain detects naive edits — but a deliberate holder of `exischryver` can still tamper
(revoke its own DENY; recompute the chain). **The PRD does not claim append-only is enforced.**

- **Slice 1 (Posture A):** `DENY` + hash-chain, residual risk disclosed to Stefan.
- **Committed next (Posture C):** stream audit rows / periodic chain-head hashes to an external
  append-only sink `exischryver` cannot reach (S3 Object Lock or separate AWS account), making
  tampering *detectable* against the privileged login. Evaluate SQL Server 2022 **ledger tables**
  as a cheap implementation if the RDS engine supports it.

**Disable paths must each hit an off-box plane.** Three ways to defeat the trail, each with a
plane: (a) direct `audit_log` tampering → Posture C; (b) ~~runtime kill-switch~~ removed —
capture changes go through versioned config; (c) code/config redeploy → **git + GitHub Actions
logs** (the traceability plane). This is real only insofar as deploys go through CI; out-of-band
box access bypasses all planes — see Separation of Duties below.

**Separation of duties (organizational dependency).** The technical controls protect against
everyone *except* a sufficiently privileged operator who holds the DB login **and** the off-box
sink **and** deploy/box access. Today that can be one person. Ultimate audit integrity therefore
rests on **separation of duties** between (1) the `exischryver`/DB-login holder, (2) the
off-box-sink owner, and (3) the deploy operator. This is an **LFSP/org control, not slice-1
code.** Detailed in the standalone *Separation of Duties* document.

**To confirm with Stefan / security programme:**
- **Retention** period for `audit_log` + archival via a separate maintenance principal. A policy
  **must exist at go-live** (the LFSP self-monitoring obligation implies retained evidence);
  Stefan sets the number. Default until set: keep all.
- **Tamper-evidence depth** beyond Posture A (timing of Posture C; ledger vs hand-rolled chain).
- Backup coverage / restore test for `audit_log`.

## 8. Dependencies & assumptions

- **DB privilege owner:** dev-1@logic.fyi holds the privileged DB login and applies the
  `audit_log` DDL + grants. (No dedicated DBA exists.)
- **Pre-go-live verification:** confirm whether `exischryver` can be narrowed; if not, ADR 0003's
  residual risk stands and weight shifts to Posture C.
- **Scope confirmation:** Stefan validates §6 against LBA obligations (§3 gate).
- **Assumption (verified):** actor identity is present at every §6 write, including integration
  endpoints (late-bound token) — resolved by write-time actor binding (§4).
- **Assumption (verified):** no batch/scheduler writers to §6 entities exist.

## 9. Portability (NFR, not a slice-1 deliverable)

`audit_log` table + the `AuditEvent` v1 contract are reused verbatim by the TypeScript stack;
only the capture mechanism is re-implemented (ORM write interceptor; middleware-populated
context). Cross-system tests (completeness, append-only, evidence pack) run against both stacks.
See `02` §E.

## 10. Out of slice 1 → slice 2

RBAC/authorization (`04-rbac-plan.md`): role/permission/user-role tables + an
`AuthorizeAttribute` subclass at the `FilterConfig.cs:15` choke point. Closes the
*unbefugter Zugriff* (access-prevention) obligation that slice 1 deliberately leaves to RBAC.
