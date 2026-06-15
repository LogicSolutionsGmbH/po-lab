# Gamma.app prompt — LBA audit-posture presentation

**Purpose:** paste-ready prompt for [gamma.app](https://gamma.app) to generate the
stakeholder deck. Derived from `01-lba-audit-discovery.md` + `02-audit-trail-surgical-plan.md`.
**Audience:** company leadership + a compliance/audit reviewer. **Focus:** backend / data
schema / DB; frontend intentionally minimal. **Use:** Gamma → "Paste in text" → Generate.

---

Create a professional, technically credible presentation for company leadership and a compliance/audit stakeholder. Topic: closing audit-posture gaps in our legacy freight-forwarding TMS (Schryver, ASP.NET MVC + SQL Server) to support LBA / EU aviation-security control objectives, with everything designed to port into our new TypeScript stack.

Audience: a mix of non-technical decision-makers and one technical/audit reviewer. Tone: pragmatic, concrete, confidence-building — not salesy, not academic. Favor tables, simple before/after framing, and clear "decision needed" callouts. Keep code to short illustrative snippets only. Backend, data-schema, and database work is the focus; state explicitly that frontend work is intentionally minimal. Use ~16 slides. Use a clean corporate look (logistics/cargo feel). Use plain language for the leadership slides and a bit more depth on the technical ones.

Build these slides in this order:

1. **Title** — "Audit Posture for Air-Cargo Data — Discovery & Surgical Plan." Subtitle: legacy TMS today → portable to the new stack.
2. **Why this matters** — As a participant in the secure air-cargo supply chain (LBA-regulated), we must be able to prove WHO changed WHAT, WHEN to identifiable air-cargo data, control who can do it, and detect tampering. Today we largely cannot. Frame around four control objectives: auditability, accountability, integrity, least privilege.
3. **The four control objectives** — one short row each, what regulators expect in plain terms.
4. **Where we are today (the honest scorecard)** — table of: Authentication = present; Authorization/roles = effectively absent (role tables exist but unused); Change history of who-changed-what = not recorded on success, only errors logged; Client IP / correlation = never captured; Passwords = stored in plaintext; Document storage = some S3 files marked public-read. Mark each red/amber/green.
5. **Two ways data gets written** — explain there are two write paths: the application's data layer (one clean choke point) and ~780 stored procedures / ~470 raw-SQL sites where the highest-risk cargo changes actually happen. Key point: a single app-layer hook would silently miss the riskiest changes.
6. **A dormant audit framework already exists** — the database already contains a generic trigger-based audit framework, but it was deliberately switched off years ago for performance reasons. We are NOT reviving triggers; we take a lighter, targeted approach instead.
7. **The highest-risk actions on cargo data** — short table of the air-cargo-identifiable operations we must cover first: close/reopen a booking, modify shipper/consignee/dangerous-goods, customs (Dakosy) declaration & participant/EORI changes, air-waybill create/modify/cancel, MAWB reservation, document export/download. One line each on why it's sensitive.
8. **Gap analysis** — three-column table: Regulatory expectation → What exists today → The gap. Cover audit trail, attribution, access control, tamper-evidence.
9. **Our approach: Audit trail first, then access control** — sequencing slide. Slice 1 = tamper-evident audit trail; Slice 2 = lightweight role-based access control. Backend/data-model first; frontend is just a simple export, nothing fancy.
10. **How the audit capture works (no triggers)** — three combined techniques: (a) a hook in the app data layer for standard writes, scoped to an allow-list of cargo tables so it stays cheap; (b) an explicit audit INSERT inside the ~8–12 high-risk stored procedures; (c) direct logging at export/download points (those are reads, invisible to write hooks). Emphasize: targeted, low-overhead, kill-switchable.
11. **The audit_log table** — show it's a single append-only table: who (actor id/email/country), when, from where (IP), correlation id, entity type & id, action, a JSON before/after diff, source system, optional tamper-evidence hash chain. One short illustrative snippet is fine.
12. **Append-only = tamper-evident** — explain the app login can only INSERT and SELECT; UPDATE/DELETE are denied at the database level, so records can't be quietly altered. Optional hash-chain adds stronger tamper detection.
13. **Evidence pack** — for any shipment, one query returns the full ordered history (who/when/what) across the booking and its linked air waybills, customs declarations, and documents — exportable to CSV/JSON for an auditor. No custom UI needed.
14. **Portable to the new TypeScript stack** — same SQL Server, so the audit_log table and the event contract are reused verbatim; only the capture code is re-implemented (ORM interceptor + middleware). Define one language-agnostic AuditEvent contract both systems emit, plus reusable cross-stack tests (completeness, append-only, evidence pack).
15. **Effort & timeline** — present Slice 1 (audit trail) as roughly 3–4 weeks for one backend developer, broken into: schema + append-only setup (~1 day), actor-context wiring (~1 day), app-layer capture hook (~1–2 days), in-stored-proc audit inserts incl. DBA review (~3–5 days), export/download logging (~2 days), evidence-pack query (~1 day), tests (~2 days), optional tamper-evidence hash chain (~1–2 days), buffer/UAT (~2–3 days). Note Slice 2 (RBAC-lite) is a separate, smaller follow-on. Show as a simple phased bar/timeline.
16. **Decisions we need from you** — bullet asks: confirmed retention period for audit records; required tamper-evidence depth (append-only only vs + hash chain vs + off-box WORM); acceptable performance overhead target; confirmation of our formal supply-chain status and which obligations the auditor will test; sign-off on the risk-ranked scope as the starting set. Close with a one-line recommendation: proceed with audit-trail Slice 1 now.
