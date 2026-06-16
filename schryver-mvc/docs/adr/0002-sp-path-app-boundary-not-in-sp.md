# SP-path audit capture is app-boundary, not in-SP

The §6 high-risk mutations run through stored procedures an EF `SaveChanges` override
can't see. The most *correct* capture is an additive `INSERT INTO audit_log` inside each
SP (atomic, captured at the true write point — surgical-plan Option 3). We reject it.

**Decision:** capture SP-path mutations at the **application boundary** (surgical-plan
Option 2): read the affected row(s) before the SP call, read after, diff in C#, write
`audit_log` — wrapping read+SP+audit in a `TransactionScope` where accuracy needs it. No
production stored-procedure bodies are edited. Slice 1 is therefore app-layer-only; the
sole DB change is creating the `audit_log` table.

**Why:** there is **no DBA and no version control on the stored procedures**. Option 3's
safety/rollback story ("revert = redeploy the prior proc body") requires the prior body to
be under version control — without it, editing a live SP (including the Dakosy customs
declaration SPs) is an irreversible change with no rollback, which violates the
"legacy-stable, low-risk" mandate.

**Consequence:** accept Option 2's known weaknesses — a read/write race window (mitigated
with `TransactionScope`/serializable on the affected actions) and per-action maintenance as
those actions change. If a DBA and SP version control are introduced later, revisit Option 3
for the integrity-critical SPs, since atomic in-SP capture has the stronger auditor story.
