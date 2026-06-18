# User Registration & Access Control — Overview

**System:** Schryver TMS (web application)
**Prepared for:** ISO audit
**Date:** 2026-06-17
**Status:** Current production behaviour

---

## 1. Account provisioning

- The application provides **no public self-registration**. Prospective users cannot
  create their own accounts.
- All accounts are created and maintained by an **administrator** through a dedicated
  user-administration screen. Account creation requires an existing authenticated
  administrative session.
- Each account record holds: username, full name, assigned office/branch, role, user
  type, interface language, account status (active / inactive), email address, and phone.
- Accounts are **deactivated, not deleted** — disabling an account is a status change,
  which preserves the account's history and prevents login while retaining auditability.

## 2. Authentication

- User authentication is **delegated to a dedicated authentication service** rather than
  handled inline by the application. The service validates credentials and issues a
  signed, time-limited session token that the application carries for the session.
- The platform is **multi-tenant**; each authentication request is scoped to its tenant,
  resolved from the request host. Users of one tenant cannot authenticate against another.
- Authentication is **mandatory by default across the entire application.** Every screen
  and action requires a valid authenticated session; the only unauthenticated surface is
  the login and password-reset flow. Unauthenticated requests are redirected to login.
- A **secondary email-token step** is supported: where the authentication service does not
  issue an immediate session token, a one-time token is emailed to the user's registered
  address and must be supplied to complete sign-in.

## 3. Credential management

- **Password reset** is self-service. A reset request emails a **single-use token that
  expires after one hour**; the password can only be changed by presenting that token.
- **Password reuse is prevented** — the system retains password history and rejects a new
  password that matches a previously used one.
- **Password expiry** is enforced. Passwords have a configurable validity period, and an
  expired password is rejected at login and must be changed before access is granted.

## 4. Access control / authorization

- The baseline control is **authentication**: no access is granted without a valid session
  (Section 2).
- **Feature-level access is granted per user.** An administrator assigns each user the
  specific set of application functions (menu/screen entries) they are permitted to use.
  Users only see and reach the functions explicitly granted to them.
- Each user is assigned a **role** and is scoped to an **office/branch and tenant**, so
  access is bounded to the user's organisational context.

## 5. Session management

- Sessions are token-based and time-limited (Section 2).
- **Logout** explicitly terminates the session and clears the authentication token and
  associated session cookies.

---

## 6. Areas under active review

The following are known and being addressed as part of an ongoing access-control
hardening initiative. They are disclosed here as managed items rather than omitted.

- **Authorization granularity.** Access is currently enforced through authentication plus
  per-user feature grants. A role-based authorization layer that enforces permissions at
  the level of individual actions (not only menu visibility) is planned, to guarantee that
  a function cannot be reached except by users explicitly entitled to it.
- **Credential storage.** The handling of stored credentials within the application
  database is under review to confirm it meets the organisation's at-rest protection
  standard (one-way hashing). Live authentication is performed by the external
  authentication service (Section 2); the review covers the application's own credential
  field.

---

*This document describes the application's current behaviour for audit purposes. It does
not include internal implementation identifiers.*
