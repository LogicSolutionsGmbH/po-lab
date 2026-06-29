# Heroes Agent Workspace (demo design)

A local, file-based interface that lets a human communicate with an agent through
files, so the agent does logistics work against the Logic Heroes API. Heroes is
the system of record; this workspace is a selective, high-availability front — not
a backup.

**North star:** this *mimics* production for experimentation and demonstration — not
a production system. Optimize for legibility; simulate the parts that would need real
external credentials (e.g. carrier visibility) rather than chase robustness.

## Language

**Workspace**:
The local folder tree. It is **input and interface, not storage** — the place a human
deposits triggers and context for the agent. Heroes stores the domain objects
(services, events, assets, subscriptions, strategy state); the agent creates/reads them
via the API by reference and does not mirror them to disk. Any local rendering of Heroes
state is a disposable view, authoritative nowhere.
_Avoid_: Mirror, backup, database, store

**System of record**:
Logic Heroes itself. The authoritative store; the Workspace defers to it on conflict.
_Avoid_: Source of truth (reserve for Heroes specifically)

**Intake**:
The filesystem-first part of the Workspace: where a human deposits raw documents and
emails — the triggers and content the agent reads to decide what to do in Heroes.
Lives **per counterparty** (`counterparties/<tenant-key>/intake/`) because every
document has a sender; a root-level intake exists *only* as a catch-all for first
contact from an unknown sender (it spawns the new counterparty folder).
_Avoid_: Inbox, dropbox, uploads; a single global intake

**Channel**:
Who *handed you* a document — the counterparty you received it from. Determines which
intake / counterparty folder it lands in. Always known to the human for free.
_Avoid_: Source, sender (when ambiguous with content)

**Content**:
Who/what is *named inside* a document — possibly many companies (e.g. a direct MBL
names shipper, consignee, carrier, forwarder). Resolved downstream into asset
participants and service membership — never into intake routing.

**Trigger**:
A thing dropped in intake that prompts the agent to act — a partner email, a booking
PDF, a simulated carrier tracking message. The agent reads it and decides the Heroes
move.

**Context** (reference material):
Standing input the human provides to guide interpretation — company terms, service
templates, counterparty notes, SOPs. Stored locally because it is *input the human
authors*, distinct from Heroes domain objects (which are not stored locally).

**Tenant**:
An organization with an identity in Heroes, addressed by its `tenant-key`. The
Workspace is rooted at one tenant ("me"); other tenants are counterparties. Every
tenant is a **symmetric peer** — same full capability set; role is never fixed to a
company.
_Avoid_: assigning a company a permanent maker/taker role

**Maker / Taker**:
The two sides of a strategy interaction, defined by *business*, not by who sends the
first message. **Maker = the party that brings the business to the network and assigns
it** (= Heroes **assigner**). **Taker = the party that accepts and performs — "rides"
the business** (= Heroes **assignee**). A role played per *move*, never fixed to a
company. Maker/taker = the business/skill names; assigner/assignee = the API anchor.
The two skills are named for these roles.
_Avoid_: open/respond, initiator/target (those name mechanics, not the economics)

**Standing offer (unsolicited quote)**:
A rate sheet handed over unsolicited ≡ a batch of per-occasion RFQs already answered:
each lane is one RFQ instance that *enters at QUOTED* — the taker quoted before being
asked. It is a **taker move** (provider pre-quoting), not a separate "ingest" action.
The maker move follows when a buyer brings business and ACCEPTs / COUNTERs that QUOTED
instance. Same strategy as solicited RFQ; just a different entry step. (Deferred — see
SCOPE.md.)
_Avoid_: import, ingest (as a distinct third concept)

**Service**:
A unit of work on a journey, exchanged between an assigner and an assignee. Holds
events; carries strategies, assets, and visibility subscriptions.

**Journey**:
The end-to-end business case a set of services belongs to (e.g. a SHIPMENT). Types:
`SHIPMENT`, `INVOICE`.

**Event**:
A timestamped occurrence recorded against a service (ACT/PLN/EST). Can carry an
attachment and link to assets and a strategy step.

**Attachment**:
A file bound to an event (inline for small text, multipart upload otherwise).

**Strategy**:
The protocol state machine that governs a service interaction — the "railway" the
agent follows. HANDSHAKE is the production one (INITIATED → ACCEPTED | REJECTED |
EXPIRED); others: TENDER, DIRECT_ASSIGNMENT, DISPUTE, AMENDMENT, CANCELLATION,
COMPLIANCE, SETTLEMENT.

**Subscription** (visibility):
A binding on a *service* to an external carrier/visibility provider (Wakeo, Hapag,
MSC, Maersk, Traxon) for a freight reference (container/booking/AWB). Pulls carrier
tracking events into the service. NOT a tenant-to-tenant feed. Lives in Heroes — not
stored locally; in the demo the carrier side is simulated.
_Avoid_: Feed, follow (those imply tenant-to-tenant; this is provider→service)

**Asset**:
A shared, multi-tenant, role-based thing tracked through a journey — physical
(container, vessel, truck, plane) or documentary (booking, MBL, MAWB, purchase
order, …). Bound to a service as cargo / transport / **document**, and referenced by
events. Roles per tenant: owner / issuer / carrier. Documents deposited in Intake
typically *become* document-type assets. Lives in Heroes — not stored locally.

## Offers & UI

**Offer**:
A rate-sheet row as an `OFFER`-type journey + service carrying facets — lane
(origin/destination LOCODE), validity timeframe, container subtype (40HC…) — with an
**RFQ** strategy instance at QUOTED. **Price-free in Heroes** (price/currency/surcharges
live in Logic-Journeys, not the offer). Importing a Maersk sheet = loop one offer per
row. (Lands via the `rfq-quotation-journey` branch; designed as if already in main.
Bulk import is deferred — see SCOPE.md.)

**RFQ**:
The negotiation railway for offers: REQUESTED → QUOTED ↔ COUNTERED → ACCEPTED
(+ REJECTED / WITHDRAWN / CANCELLED / EXPIRED). An ACCEPTED offer can `instantiate`
into a SHIPMENT.

**Dashboard**:
A static HTML/CSS/JS UI, one per peer. **Read-only** — it renders the agent's OUT
projection from the filesystem and polls to *look* reactive; it makes no API calls.
Two jobs: (1) show the agent working, (2) surface the human-in-the-loop decision points.
Price never shows here.
_Avoid_: app, frontend-that-calls-the-API

**Projection (OUT files)**:
JSON the agent writes to the filesystem reflecting Heroes state + its own activity +
pending decisions. The dashboard's only data source. Disposable, regenerable from Heroes.
_Avoid_: store, database, cache
