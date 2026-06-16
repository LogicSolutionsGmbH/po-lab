# Separation of Duties — Schryver TMS audit trail

**Purpose:** The audit trail's technical controls (`03-audit-trail-prd.md`, ADR 0003) protect
the integrity of identifiable air-cargo data against unauthorized and lesser-privileged actors.
They do **not**, and cannot, protect it against a sufficiently privileged *operator*. That
residual gap is closed only by **separation of duties** — an organizational control that belongs
in the LFSP (Luftfracht-Sicherheitsprogramm), not in application code. This document states the
control so Stefan Reuter can either accept the residual risk or assign the separation before
attesting LBA compliance.

**Audience:** Stefan Reuter (acceptance authority) + Logic infra/leadership.
**Related:** `03-audit-trail-prd.md` §7; ADR 0003; regulatory anchors (DVO (EU) 2015/1998 §6.4.2.1
— *vor unbefugtem Zugriff oder Manipulation*).

---

## 1. Why technical controls are not enough

The audit trail can be defeated in exactly three ways. Each is countered by a control plane that
lives **outside** the application database and outside the app login `exischryver`:

| Defeat path | Control plane | Holds against |
|---|---|---|
| Tamper with `audit_log` rows directly | Off-box append-only sink (Posture C: S3 Object Lock / separate account / SQL 2022 ledger) | everyone who cannot reach the off-box sink |
| Change capture logic via deploy | git history + GitHub Actions deploy logs | everyone who cannot deploy out-of-band |
| Change capture config | versioned config through GitHub Actions (no runtime kill-switch) | same as above |

Every plane assumes the **operator is honest**: the off-box anchor assumes the DB-login holder
does not also own the off-box sink; the git/CI plane assumes deploys cannot be made out-of-band
(direct box access bypasses CI entirely). When one person holds all of these capabilities, the
audit trail protects against *everyone but that person* — and no amount of code changes that.

## 2. The three privileged capabilities to separate

1. **DB-login holder** — controls `exischryver` (full DB rights today). Can read/alter/delete
   `audit_log` rows and re-grant permissions.
2. **Off-box-sink owner** — controls the external append-only store (Posture C) and its
   credentials/account. Can alter or delete the off-box copy / digests.
3. **Deploy operator** — can change capture logic or config and ship it, or (worse) change the
   running app/config **out-of-band** on the host, bypassing git + CI.

Integrity holds when **no single individual holds two of these three**, and ideally all three are
held by different people, at least one of whom is independent of day-to-day cargo operations.

## 3. Current state (to be confirmed)

As of 2026-06-16, dev-1@logic.fyi holds the privileged DB login **and** the infrastructure — i.e.
capabilities (1), (2), and (3) are concentrated. **This is the single largest residual risk in the
audit design** and must be surfaced to Stefan, not hidden.

## 4. Target separation

- **(1) DB-login holder** ≠ **(3) deploy operator.** The person who can alter audit rows in the DB
  is not the person who can ship code/config that changes capture.
- **(2) Off-box-sink owner** is independent of (1). The off-box anchor is only meaningful if its
  owner cannot also alter the in-DB rows it anchors. Prefer a sink in a **separate AWS account**
  with its own credentials, ideally administered by someone outside the app team.
- **Out-of-band deploys are disabled or detected.** Deploys go through GitHub Actions only; direct
  host/config access is restricted and, where it exists, alerted on. Without this, the git/CI plane
  is theoretical.
- **Privileged-action logging.** Administrative DB actions and out-of-band host access are logged
  to a destination none of the three roles can unilaterally erase.

## 5. Interim mitigations while separation is incomplete

If the capabilities cannot yet be split across people (small team), reduce the *blast radius* and
increase *detectability*:

- Ship **Posture C** (off-box anchor) early — even self-owned, an off-box immutable copy raises the
  bar from "silent edit" to "edit that contradicts an external record."
- Route the off-box sink to an account/credential set distinct from the app's, even if the same
  person administers both, so a single compromised credential does not reach both planes.
- Record administrative/out-of-band actions to the off-box plane.
- **Document the concentration explicitly** in the LFSP so the LBA sees it is known and managed,
  not overlooked. A disclosed, managed limitation is defensible; an undisclosed one is what fails
  an inspection.

## 6. What Stefan is asked to decide

1. Accept the current concentration as a **disclosed, managed residual risk** (with §5 interim
   mitigations) for go-live, **or** require the §4 separation before sign-off.
2. Name the owners of capabilities (1), (2), (3).
3. Confirm this control is reflected in the LFSP's self-monitoring / integrity section.
