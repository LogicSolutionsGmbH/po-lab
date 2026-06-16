# Handoff — run the audit-posture analysis on the new TypeScript stack

**Goal:** repeat the legacy audit-posture analysis (`01-lba-audit-discovery.md` →
`02-audit-trail-surgical-plan.md` → `03-audit-trail-prd.md`) against the **new TypeScript stack**,
to evaluate **how close that stack already is to LBA compliance** vs the legacy .NET app — and
where it would land the same five decisions.

> **Target repo:** the new TS stack — **NOT** `core-node`. Specify the correct repo at kickoff and
> pull it as a gitignored `source/` substrate first (pull-context skill). Bring as much context as
> possible; the value of this analysis is proportional to how much of the real code is in view.

## Frame the question, don't just inventory
The legacy analysis was about *retrofitting* audit onto a hostile substrate. Here the question is
the opposite: **is the new stack a friendlier substrate, such that some slice-1 compromises become
unnecessary?** Specifically, re-run each of the five decisions the PRD settled and check whether the
TS stack flips them:

| Decision (legacy outcome) | What to check in TS | Why it might flip |
|---|---|---|
| **Write-path completeness** — legacy had 571 EF sites + 779 SPs, so capture had to be split (chassis + app-boundary) | Is there a **single ORM write choke point** (TypeORM `EntitySubscriber` / Prisma `$extends` / Knex hook)? Are there still raw SPs/raw SQL? | A clean interceptor + no SPs = one capture mechanism, not two. The `AuditEvent` v1 contract (`02` §E) is the target. |
| **In-SP capture rejected** (no DBA / no SP version control) | Does the TS stack avoid SPs entirely? Is the DB schema **migration-managed** (versioned)? | Versioned migrations restore the rollback story; SP-free removes the whole Option-2/3 problem. |
| **Append-only = mitigation only** (`exischryver` omnipotent; ADR 0003) | Does the TS app run under a **least-privilege DB login** (not db_owner)? Separate read/write principals? | If yes, Posture B is *native* here — `DENY` actually holds, and the off-box anchor (Posture C) becomes optional rather than load-bearing. **This is the single most important thing to check.** |
| **Attribution** — late-bound integration tokens, resolve at write time | How is request-scoped identity carried (Nest interceptor / AsyncLocalStorage)? Is actor available at write time uniformly? | Middleware-populated context may already give clean, uniform attribution. |
| **No RBAC** (bare AuthorizeAttribute) | Are there **Guards / policy decorators / a permission model** already? | If RBAC exists, slice 2 may be largely done in the TS stack. |

## Also assess (same axes as discovery §1–§6)
- **Tech stack as found** (framework, ORM, DB engine + version — note if **SQL Server 2022** so
  *ledger tables* / off-box digests are available for Posture C).
- **Auth/identity:** is JWT signature actually verified here (legacy did **not** — `DoNotVerifySignature`)?
  Plaintext passwords gone?
- **Logging/telemetry:** is there structured logging / an existing event sink that Posture C could ride?
- **Identifiability fields:** does the TS data model carry the multimodal `tp_movimiento*`-equivalent
  (Versandart)? The audit-all / no-mode-filter decision (ADR 0001) must port.
- **§6 equivalent actions:** map the legacy §6 risk-ranked actions onto their TS counterparts
  (Booking close/reopen, Dakosy declaration, AWB enable/disable, MAWB reservation, exports, doc hide).

## Deliverable
A discovery doc in the **TS project's** `notes/` mirroring `01`, ending in a **gap scorecard**:
for each of the five decisions above — *already solved / partially / not yet* — plus a one-line
verdict: **is the TS stack closer to LBA-ready, and what is the shortest path to parity with (then
beyond) legacy slice 1?** Reuse the `audit_log` DDL + `AuditEvent` contract verbatim as the bar.

## Read first
`01`, `02`, `03`, `audit-separation-of-duties.md`, ADRs 0001–0003, `CONTEXT.md`, and memory
`lba-regulatory-anchors.md`.
