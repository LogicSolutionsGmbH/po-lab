# Schryver TMS — Audit Trail

The audit-trail / compliance capability for the Schryver TMS (Logic's transport-management
product). Slice 1 ships into the legacy .NET app and is a go-live gating feature for
Schryver's migration off Cargosoft onto Logic.

## Language

**Schryver**:
The customer — a freight forwarder / air-cargo operator. The party that must be able to
run regulated air-cargo operations on Logic's TMS.
_Avoid_: client, account.

**Logic**:
The vendor (Logic Solutions GmbH) and its TMS product. "Logic's TMS" = the .NET Schryver
MVC app today (`logic-schryverMvc`), with a TypeScript rewrite in progress.

**Cargosoft**:
The incumbent third-party TMS Schryver currently runs and wants to leave. The audit-trail
gap is what would otherwise block leaving it.

**LBA** (Luftfahrt-Bundesamt):
The German federal aviation authority that regulates air-cargo security and grants
*reglementierter Beauftragter* (regulated agent) and *bekannter Versender* (known consignor)
status. The regulatory driver for this work.
_Avoid_: LBV.

**Slice 1**:
The shippable unit of this PRD: tamper-evident change capture + evidence reporting for the
§6 risk-ranked air-cargo actions, in the legacy .NET app. RBAC is slice 2.

**Consignment**:
A single shipment record. Realized as `TESch_Booking`. **Multimodal** — carries air,
ocean, and road movements (`tp_movimientoAereo/Maritimo/Terrestre/Principal`); not every
consignment is air cargo.
_Avoid_: booking (use only when naming the table/entity).

**Transport mode (Versandart)**:
The fields that mark a consignment as air / ocean / road (`tp_movimiento*`). Regulatorily
load-bearing: a change here can move a consignment into or out of LBA air-cargo scope, so
it is a first-class audited field, and the audit allow-list keys on entity type — never on
mode (see ADR 0001).

**Audit trail**:
The append-only `audit_log` capture built by this PRD. Distinct from the legacy *dormant
trigger-driven audit framework* (`AuditHeader`/`AuditDetail`, deactivated for performance),
from operation-scoped *bitácoras*, and from `AuditoriaClausura` (an accounting period-close
lock, not change capture).
_Avoid_: using "audit" bare to mean any of the legacy mechanisms.

**Append-only (audit_log)**:
The integrity property of `audit_log`. In slice 1 it is *mitigation, not guarantee*: the
`DENY` blocks accidental and lesser-privilege writes, but the app login `exischryver` is
omnipotent and can still tamper. Real tamper-evidence comes from the committed **off-box
anchor** (Posture C). Never describe slice-1 append-only as "enforced" without this caveat
(see ADR 0003).

**Evidence pack**:
The who/what/when ordered change history for one consignment and everything linked to it,
exported as CSV/JSON for an auditor. No log-viewer UI in slice 1 — a query + export.

**Acceptance authority**:
Stefan Reuter — signs the internal document attesting the system complies with LBA
regulation; first contact for the compliance relationship.
