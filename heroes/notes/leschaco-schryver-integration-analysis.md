# Schryver ↔ Leschaco ↔ Heroes — integration analysis

> Working analysis (po-lab). Cross-examines three source artifacts Carlos dropped in
> `KB/Entities/Leshaco/Assets/` against the real Heroes model (`po-lab/heroes/source`).
> Goal: extract the event types / closing types / worksteps, map them onto Heroes
> events·services·strategies, and flag **what flows from which system**. Not a PRD yet —
> this is the substrate for the integration-definition session.
>
> Date: 2026-06-26. Companion to the webhook ideation (`notes/webhooks-tenant-vs-instance-ideation.md`)
> and the Leschaco entity note (`KB/Entities/Leshaco/Entity.md`). Spelling: the company spells
> itself **Leschaco**; the KB folder is "Leshaco".

---

## 0. TL;DR

- The **use case** is the Schryver Germany ↔ Leschaco **LCL container consolidation at the Bremen warehouse** (Leschaco runs the CFS/warehouse; Schryver is the forwarder). The S&OP doc is effectively the integration spec — it already lists *which documents are meant to flow via system*.
- **Three systems**, three roles: **Schryver TMS** (process of record, emits worksteps/events) → **Heroes** (the inter-company event + service layer) → **Leschaco / Seeburger EDI** (receives + emits via its API gateway). Heroes is the middle.
- **Event vocabulary maps well**: ~30 of the 44 `EventTypeIds` already have Heroes equivalents through the existing DCSA + Traxon transforms. The **gaps are precisely the warehouse/consolidation touchpoints** (CFS gate, loading start/complete, customs release export) — and **Heroes has no warehouse/consolidation service template** (only air/sea/LTL visibility today).
- **Two clean structural gaps in Heroes** surface immediately: (1) **no cut-off / deadline concept** for the 7 `ClosingTypes`; (2) **no consolidation service template / milestone set**. Both are net-new and should be on the design agenda.
- **Worksteps ≠ events.** The Schryver worksteps file is the *internal* TMS workflow (stages → worksteps → substeps). Only a curated subset (the externally-relevant ones — the doc has a "Milestone?" column for exactly this) should cross into Heroes as events. Most stay inside Schryver.

---

## 1. The three source artifacts — what each is, whose system

| File | What it is | System of origin | Role in the integration |
|---|---|---|---|
| `1. S&OP Schryver Consolidated Container.docx` | Business-process spec for LCL consolidation at the Bremen warehouse — responsibilities, documents, exceptions, invoicing. Ends with an explicit **"info/documents that can be automatically shared via System"** + "Milestones/Worksteps that can be automatically updated through systems." | Joint Schryver/Leschaco (business) | **The integration contract.** Names the data flows and direction. Start here. |
| `EventTypes_ClosingTypes.xlsx` | A normalized catalog: **44 `EventTypeIds`** (id, name, description, air-only / sea-only flags) + **7 `ClosingTypeIds`** (cut-offs). | Shared event catalog (Heroes- or Schryver-side reference data) | **The event vocabulary** to reconcile with Heroes milestones/event-names. |
| `Schryver germany-worksteps.xlsx` | **7 TMS workflows** (Export Sea CO/FCL/LCL/NC, Import Sea CO/FCL/LCL) decomposed into Stage → Workstep → Substep, each row carrying a **`Milestone?`** flag and a full path. Export workflows in English, Import in German. | Schryver TMS (internal) | **The internal process** — source of which steps *could* be exposed as events. |

> Note: the `EventTypeIds` codes line up with Heroes' existing carrier vocab (DCSA sea codes + Traxon air FSU codes — see §4). That strongly suggests this catalog is already the *normalized* layer, not a raw carrier feed — i.e. it's the natural seed for a Heroes milestone/event-name set.

---

## 2. The integration in one picture

```
   SCHRYVER TMS                      HEROES                         LESCHACO
 (process of record)        (inter-company event/service        (warehouse / CFS)
                                     layer)                      via SEEBURGER EDI
        │                              │                                │
        │  worksteps advance           │                                │
        │  (Stage>Workstep)            │                                │
        │── Transport Order ─────────► service request (handshake) ───► Seeburger API GW
        │── A08 / Cargo List ────────► payload on the service ────────► (Leschaco WMS)
        │── DGD / Container Release ─► attachments (assets) ──────────►│
        │                              │                                │
        │                              │◄── Warehouse Receipt ──────────│ (Leschaco emits)
        │◄── events on the service ───◄── VGM ────────────────────────│  via Seeburger →
        │   (milestones actualised)    │◄── Final Loading Report+Fotos │  Heroes webhook
        │                              │◄── Invoicing ─────────────────│
        │                              │                                │
```

- **Outbound to Leschaco** = Heroes → Leschaco's Seeburger API gateway. This is exactly the **outbound-webhook** question from the 2026-06-26 ideation: does Leschaco get a *tenant-level* endpoint (everything for their tenant) or a *service-instance-level* one (this consolidation only)? Leschaco's "one central Seeburger gateway" leans **tenant-level**; see that doc.
- **Inbound from Leschaco** (Warehouse Receipt, VGM, Loading Report) = Leschaco POSTs to Heroes — structurally identical to the existing per-source inbound webhooks (`/pipelines/webhook/wakeo|traxon|hapag-iot`). A **`/webhook/leschaco`** (or generic tenant-authenticated inbound) is the natural shape.

---

## 3. Document/data flows from the S&OP → Heroes representation

The S&OP's own "can be shared via System" list, mapped to Heroes primitives (asset types from `assets.enums.ts:7-28`, external-ref types, events):

| Document / data | Direction | Heroes representation | Notes / gap |
|---|---|---|---|
| **Transport Order (TO)** | Schryver → Leschaco | Triggers a **service request** (handshake strategy); TO itself = `asset type=transport_order`, ref `transport_order_number` | The TO *is* the consolidation hand-off. Maps to `HANDSHAKE` INITIATED. |
| **Stuffing / Stuffing Order to Warehouse** | Schryver → Leschaco | Service request payload / event `name="Stuffing Order"` | No milestone today; warehouse-specific (gap). |
| **A08** (shipment details: pkgs, weight, marks, ref) | Schryver → Leschaco | Service payload (JSON) on the service; cargo as `asset type=cargo` | A08 = Schryver shipment manifest. |
| **DGD** (dangerous goods) | Schryver → Leschaco | `eventAttachments` / document asset | Conditional. |
| **Container Release** | Schryver → Leschaco | document asset / event | |
| **Preliminary + Final Cargo List** | Schryver → Leschaco | Service payload, versioned (prelim→final) | "Final one day prior to loading" → a **PLN deadline** (no cut-off concept; see §5). |
| **Warehouse Receipt** | Leschaco → Schryver | **inbound event** `name="Warehouse Receipt"` + doc asset; ref to Leschaco reference number | Warehouse milestone (gap — no template). EventTypeId analog: "Received at origin" (74) / Gate In CFS (73). |
| **VGM** (verified gross mass) | Leschaco → Schryver | inbound event `name="VGM"` (data, not just doc) | **No VGM concept in Heroes** (only a doc-type code in carrier ref). Gap. |
| **Final Loading Report + Fotos** | Leschaco → Schryver | inbound event + photo attachments (S3) | Maps to "Loading Completed" (14). Photos = `eventAttachments`. |
| **Invoicing** | Leschaco → Schryver | event `name="Invoice Issued"`; charge data as payload | Must carry the Schryver Reference (the S&OP mandates it on every invoice). Billing not modeled in Heroes — likely stays a payload. |

**Identity / linkage that must survive the hop:** the S&OP repeatedly pins everything to the **Schryver Reference number** (and Leschaco supplies its own **Leschaco Reference**). In Heroes these are `serviceReference` rows per `serviceParticipant` (`journeys.tables.ts` — each participant can hold multiple business identifiers). This is the join key across the three systems and should be mandatory on the service.

---

## 4. Event-vocabulary crosswalk: `EventTypeIds` → Heroes

Heroes resolves a free-text `event.name` to a **milestone** via LLM (`event-resolution.service.ts`), and milestones are **per service template** (`seed.sql:63-80`). Heroes already normalizes carrier codes to event names in `shared/dcsa-transforms.ts` and the Traxon transform. So the crosswalk is mostly "does an existing Heroes event-name already cover this code."

### 4a. Sea events — strong overlap, warehouse gaps
| EventTypeId | Name | Heroes equivalent (source) | Seafreight template milestone | Status |
|---|---|---|---|---|
| 17 | Loaded | `LOAD` "Container loaded on vessel" (dcsa-transforms) | m2 (vessel) | ✅ direct |
| 18 / 27 | Unloaded / Discharged | `DISC` "Container unloaded from vessel" | m3→ | ✅ direct |
| 21 | Departure | `DEPA` "Vessel departure" | m2 | ✅ direct |
| 26 | Arrival | `ARRI` "Vessel arrival" | m3 | ✅ direct |
| 16 | Gate In Full | `GTIN` laden "Laden container gate in" | m1 | ✅ direct |
| 36 | Gate Out Full | `GTOT` laden "Laden container gate out" | m4 | ✅ direct |
| 11 | Gate Out empty | `GTOT` empty | m0-ish | ✅ direct |
| 41 | Gate In Empty | `GTIN` empty / "Empty container returned" | m5 | ✅ direct |
| 10 | Empty container Release | `PICK` "Empty container pick-up" | m0 | ✅ direct |
| 71 / 39 | Container stripped / Unloading Completed | `STRP` "Container stripped" | — | ✅ direct |
| 14 / 13 | Loading Completed / Loading Start | `STUF` "Container stuffed" (partial) | — | ⚠️ partial (no "start") |
| 73 / 79 | **Gate In CFS / Gate Out CFS** | *none* — CFS = consolidation warehouse | — | ❌ **gap (Leschaco core)** |
| 74 | Received at origin | "Received at origin" / REH | — | ⚠️ name only |
| 7 | Customs Release Export | shipment `RELS`/`CCD`-ish, not a sea milestone | — | ⚠️ shipment-level |
| 28 / 30 | Full container Release / Customs Release Import | import-side release | — | ⚠️ shipment-level |
| 43 | Door Delivery | "Container delivered" / POD | — | ✅/⚠️ |
| 38 | Unloading Start | (none; precedes STRP) | — | ⚠️ |

### 4b. Air events — covered by the Traxon FSU map
EventTypeIds 52–70 (PUP, REH, DOC, RCS, RCF, DEP, ARR, NFD, AWD, DLV, DIH, POD, HPN, TBN, ICC, FPD, OFD) line up with the **Traxon air FSU codes** already mapped in Heroes (`RCS`, `DEP`, `ARR`, `RCF`, `NFD`, `DLV`, `CCD`→ICC, …) and the **airfreight template** milestones (RCS→DEP→ARR→RCF, `seed.sql`). ✅ Mostly direct; the courier/handover ones (HPN, TBN, OFD) are finer-grained than Heroes milestones and would be plain events (no milestone).

### 4c. Reading the crosswalk
- **The ~30 "direct" rows need no new design** — they already resolve. The integration work for these is *seeding event-name aliases/examples* so the LLM resolver maps the EventTypeId names confidently (the resolver is example-trained; unknown names default to regressive/stagnant).
- **The ❌/⚠️ rows are the real scope, and they cluster on the warehouse**: CFS gate in/out (73/79), Loading Start/Completed (13/14), Warehouse Receipt, VGM. These are exactly Leschaco's touchpoints — and they have **no service template** to belong to. → §6.

---

## 5. Closing / cut-off types — a clean Heroes gap

`ClosingTypeIds`: **1** Cargo Cut Off · **2** IMO Cut Off · **3** VGM Cut Off · **4** Document Closing · **5** Customs Closing · **6** Requested Delivery Date · **7** Cargo Ready Date.

**Heroes has no cut-off/deadline/closing concept** (searched `cutoff|cut-off|closing|deadline` across source — only ad-hoc `closingAt` on a booking strategy and trip-timeout constants; nothing first-class). Yet the S&OP leans on deadlines ("Final cargo list one day prior to planned loading").

Options to put on the design table:
1. **Model as `PLN` events** (`eventType='PLN'`, `name="VGM Cut Off"`, `eventAt=deadline`) — cheapest, reuses the event model, and a passed PLN with no matching `ACT` = a missed cut-off. Pairs naturally with the **reminder/notification** mechanism Carlos already built (and with the webhook ideation — a cut-off approaching is a prime webhook trigger).
2. **First-class cut-off table** keyed to the service — more explicit, supports countdown UI, but net-new schema.

Recommendation: start with (1) as a `PLN`-event convention; revisit (2) only if cut-offs need their own lifecycle. **This is a genuine net-new concept either way — flag it for Valeriy/Arturo.**

---

## 6. Worksteps → events, and the missing consolidation service

### 6a. Worksteps are mostly internal
The worksteps file is **Schryver's internal TMS process** (e.g. Export Sea LCL `wf-200`: Create Position → Offer → Booking Request → … → Warehouse Receipt → Sailing Confirmation → BLs by Courier → Close File). Most of these (Create Position, Offer, Selling Rate, Memo, Close File) are **internal and must NOT leak into Heroes**. The file even carries a **`Milestone?`** column — that flag is the intended filter for "externally visible."

**Principle:** Heroes events = the *milestone-flagged, counterpart-relevant* worksteps only. The rest stay in Schryver TMS. This keeps Heroes the *inter-company* layer, not a mirror of Schryver's back office — consistent with the API scope Valeriy stated (operational: journeys/services/events, nothing internal).

### 6b. The consolidation-relevant worksteps (Export Sea LCL / CO)
From `wf-200` (LCL) and `wf-198` (CO), the steps that touch Leschaco / become events:
- **Transport Order / Stuffing Order to Warehouse** → service request (handshake) to Leschaco.
- **Warehouse Receipt → Receipt Confirmation** → Leschaco inbound events.
- **Container Delivery, VGM, Packing Certificate, Loading Confirmation/Final Docs** → events (some Schryver-emitted, some Leschaco-emitted).
- **Shipping Instructions (Container #, Seal #, Tare Weight)** → asset reference updates on the container asset.

### 6c. Heroes needs a consolidation service template
Seeded templates today: `realtime_airfreight_visibility`, `realtime_seafreight_visibility`, `ltl_pickup_origin`, `ltl_pickup_destination` (`seed.sql:63-80`). **There is no warehouse/consolidation template.** The Leschaco flow needs a new `templateService` (e.g. `lcl_consolidation` / `warehouse_stuffing`) with its own milestone set, roughly:

`Warehouse Receipt (Gate In CFS) → Cargo Validated → Stuffing Started (Loading Start) → Stuffed/Loaded (Loading Completed) → VGM Submitted → Container Gate Out (CFS) → Loading Report Issued`

Templates are extensible via `POST /api/journeys/templates`, so this is additive, not a refactor — but the milestone set + the LLM resolver examples have to be authored. **This template is the single biggest net-new artifact for the integration.**

---

## 7. What flows from which system (system-of-record)

| Event / datum | Emitting system | Into Heroes via | Heroes object |
|---|---|---|---|
| Transport Order, A08, Cargo Lists, DGD, Container Release | **Schryver TMS** | API push (Schryver already pushes service requests) | service request + assets/payload |
| Booking / vessel / departure-arrival (sea), flight events (air) | **Carriers** (via Wakeo/Traxon/DCSA) | existing inbound pipelines | events → milestones (already works) |
| Warehouse Receipt, VGM, Final Loading Report + Fotos, Receipt Confirmation, Invoicing | **Leschaco** (Seeburger EDI) | new inbound webhook `/webhook/leschaco` (mirror wakeo/traxon pattern) | events + attachments on the consolidation service |
| Cut-offs (Cargo/IMO/VGM/Document/Customs), Cargo Ready, Requested Delivery | **Schryver TMS** (planning) | API push as `PLN` events | PLN events (per §5) |
| Worksteps (internal: Offer, Memo, Close File, …) | **Schryver TMS** | — | **stay internal, do not flow** |

---

## 8. Gaps & open questions for the integration-definition session

1. **Consolidation service template** — confirm we create `lcl_consolidation` (+ milestone set + resolver examples). Owner? (§6c) — *biggest item.*
2. **Cut-off concept** — `PLN`-event convention vs first-class table (§5). Net-new; Valeriy/Arturo call.
3. **CFS warehouse events** (Gate In/Out CFS, Loading Start/Complete) — author event-names + milestones; these are Leschaco's core and currently unmapped (§4c).
4. **VGM as data** — VGM is both a *cut-off* and a *value Leschaco returns*; model both (a PLN cut-off event + an ACT event carrying the figure).
5. **Outbound delivery to Leschaco** — tenant-level vs service-instance webhook (ties to `webhooks-tenant-vs-instance-ideation.md`). Leschaco's single Seeburger gateway argues tenant-level; confirm with Christian Frank.
6. **Inbound from Leschaco** — Seeburger will POST to Heroes; define auth (per-tenant token like `wakeoToken`), payload schema, and which Leschaco reference joins to the Schryver reference.
7. **Worksteps "Milestone?" flag** — get the authoritative list of which worksteps are externally shareable (the file has the column; confirm it's filled/trusted) so we don't over- or under-expose.
8. **Reference join** — enforce Schryver Reference + Leschaco Reference on every consolidation service (the universal key across all three systems).
9. **Air vs sea scope** — the catalog covers both; the Bremen consolidation case is **Export Sea LCL** first. Confirm phase 1 = sea LCL consolidation only.

---

## 9. Sources
- `KB/Entities/Leshaco/Assets/1. S&OP Schryver Consolidated Container.docx` (business contract)
- `KB/Entities/Leshaco/Assets/EventTypes_ClosingTypes.xlsx` (event + closing catalog)
- `KB/Entities/Leshaco/Assets/Schryver germany-worksteps.xlsx` (TMS workflows)
- `KB/Entities/Leshaco/Entity.md` — Leschaco = Bremen forwarder + warehouse; central EDI = **Seeburger BIS**, API gateway self-managed; counterpart **Christian Frank**.
- Heroes model: `packages/database/seed.sql:63-80` (templates+milestones), `packages/database/src/schemas/journeys/journeys.tables.ts` (service, milestone, references), `journeys.enums.ts:11` (ACT/PLN/EST), `assets/assets.enums.ts:7-28` (asset types), `packages/services/src/journeys/services/event-resolution.service.ts` (LLM milestone resolution), `apps/api/src/modules/pipelines/routes/shared/dcsa-transforms.ts` + Traxon transform (carrier code → event-name maps), `strategies/registry.ts` (HANDSHAKE).
- Companion: `notes/webhooks-tenant-vs-instance-ideation.md`.
