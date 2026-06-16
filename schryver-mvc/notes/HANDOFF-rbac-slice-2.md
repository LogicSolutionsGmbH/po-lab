# Handoff — RBAC (audit slice 2)

**Predecessor:** `03-audit-trail-prd.md` (slice 1, audit trail). Read it + `01-lba-audit-discovery.md`
§4 first. **Acceptance authority:** Stefan Reuter. **Regulatory anchors:** see memory
`lba-regulatory-anchors.md`.

## Why slice 2 exists
Slice 1 deliberately left **access prevention** out of scope. The LBA obligation it does *not*
close is *vor unbefugtem **Zugriff*** (DVO (EU) 2015/1998 §6.4.2.1) — controlling **who may act on
identifiable air-cargo data** — plus the accountability side of the *reglementierter Beauftragter*
regime (named Sicherheitsbeauftragter, Zuverlässigkeitsüberprüfung per §7 LuftSiG, least privilege).
Slice 1 already emits `PERMISSION_CHANGE`, so RBAC events become auditable the moment slice 2 lands.

## Starting facts (from discovery §4 — re-verify against current `source/`)
- Authorization is effectively **absent**: the global filter is a bare `new AuthorizeAttribute()`
  at `FilterConfig.cs:15` — authenticated-or-not, **no roles**. Zero `[Authorize(Roles=…)]`, zero
  `IsInRole`.
- Role tables **exist but are dead**: `TCSch_RolUsuario`, `TRSch_UsuarioRoles`,
  `TCSch_Usuario.cd_identityRolUsuario` — never consulted for access decisions.
- The only live check is **menu visibility** (`TRSch_AccsesoUsuario` → `TCSch_SubMenu` via
  `CustomAuthorizeAttribute`) — gates menu items, **not actions/data**, rarely applied.
- ⚠ Passwords stored **plaintext** (`TCSch_Usuario.tx_contrasena`). Flag to Stefan — likely its own
  finding, possibly a precondition.

## The choke point
A single `AuthorizeAttribute` subclass swapped in at `FilterConfig.cs:15` (or
`BaseController.OnActionExecuting`) mapping controller/action → required permission, checked against
new role/permission tables. Identity is already in-process (`SessionHelper`, `cd_identityUsuario`).

## What to produce (mirror the slice-1 sequence)
1. **Decide:** revive the dead role tables vs. new `roles`/`permissions`/`user_roles` schema.
   Recommendation to test: new tables (the dead ones carry unknown legacy semantics); DDL in the
   same portable, same-MSSQL style as `audit_log`, reused verbatim by the TS stack.
2. **Permission model:** start from the §6 actions — each becomes a permission; map the rest of the
   controller/action surface incrementally. Default-deny at the choke point.
3. **Authorization matrix** as the acceptance test (the slice-1 portability doc already lists this as
   the slice-2 cross-system test): "role X cannot perform action Y on resource Z."
4. **Tenant scope:** authorization must respect `cd_identityPaisUsuario` (existing tenant claim).
5. **Portability:** define the `RolePolicy` contract once (legacy realizes it via the
   `AuthorizeAttribute` subclass; new stack via a policy engine / guard).
6. **PRD** in the same shape as `03`: goals, scope, ACs, NFRs, dependencies, Stefan sign-off.

## Open items for Stefan
- Plaintext-password remediation: in scope for slice 2, or separate?
- Role taxonomy: who defines the roles (operations vs security officer vs admin)?
- Does the LFSP name specific role/duty separations (ties to the Separation of Duties doc)?
