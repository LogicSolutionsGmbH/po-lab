# Invoice-provision SELECT crosswalk — journeys ↔ email-worker

**Purpose:** replay the *exact* inline SQL that each system runs during invoice
processing, by supplying only the parameters each query needs, so we can step
through the flow and confirm both sides look at the same rows from the same
angle. **No rewritten / consolidated queries** — every runnable file under
`queries/invoice-provision/` is the verbatim SQL from source (or, for
Kysely-builder queries, its faithful compiled T-SQL with the source line noted).

- journeys context: `main` `f7e50a4` (2026-06-24)
- email-worker context: `main` `071a33f` (2026-06-24)
- Runnable SQL: `journeys/queries/invoice-provision/`, `email-worker/queries/invoice-provision/`

---

## 0. Status semantics (resolved against source — the thing we debug around)

`TESch_FacturaExtraidaContabilizada` is the invoice↔provision tag table. Its
`st_estatus` (INT) plus `cd_identityBookingCosto` define the inbox badge.
Authoritative definition: journeys `invoices.provision-state.ts:7-12`
(`buildFacturaProvisionStateMaps`) and worker
`tag.provision.with.invoice.workflow.ts:96-258`.

| Term (user) | `st_estatus` | `cd_identityBookingCosto` | Meaning |
|---|---|---|---|
| **booked**   | `1` | NOT NULL | provision found **and already invoiced in the legacy FPRO purchase-invoice tables** (`matchProvision` → true) |
| **matched**  | `0` | NOT NULL | provision found, **not yet** billed in legacy |
| **unmatched / unresolved** | `0` | **NULL** (placeholder) | worker could not resolve vendor / booking / provision — no badge |

> ⚠️ Correction: an earlier scan annotated the worker side as "1 = matched /
> 0 = unmatched". That is **wrong**. Both systems use **0 = matched, 1 = booked**.
> `update.provision.status.ts` only carries a generic "1 = active / 0 = inactive"
> comment, but the worker's own `fetch.sender.vendor.rankings.ts` filters
> `st_estatus = 1` as *booked* (`bookedCount`, `lastBookedAt`), and the workflow
> sets `st_estatus = 1` only when `matchProvision(...)` is true. No real
> cross-system mismatch on the codes.

**Who writes vs who reads:** the **worker** (`tagProvisionWithInvoiceWorkflow`)
*writes* these rows hours/days ahead. **journeys** *reads* them for the inbox,
and **re-triggers the same matching** when you open the provisions view —
running the journeys-side twins of the worker queries below.

---

## Canonical diagnostic (start here)

`journeys/queries/invoice-provision/dx_factura_status_canonical.sql` — one
**composed** query (not a verbatim app query, but built from the verified joins
below). Feed it `@cd_identityTenant` + a **document name**
(`ActivoDigital.tx_nombreArchivo`) — or `@cd_identityBookingCosto` /
`@cd_identityFacturaExtraida` as alternates — and it returns one row per
provision link with:

- **estado**: `pending` / `unmatched` / `matched` / `booked`
- if **booked** → the legacy invoice it was booked to (`booked_cd_identityFactura`,
  `booked_nu_factura`, issue date, booked-by user)
- full context in the same row: shipment reference, booking, booking-cost amount,
  concepto, currency, vendor, responsible country.

Country-agnostic (resolves FPRO tables at runtime). Use it to validate a single
invoice end-to-end; drop to the per-step queries below to see exactly which app
query produced a given value.

## The flow, step by step

```
            EMAIL-WORKER (writes the tag, ahead of time)         JOURNEYS (reads + re-triggers on demand)
STEP 1  fetch.unprocessed.invoices  ──► tag w/ st_estatus 0/1     getFacturaProvisionStateByFacturaIds (badges)
                 │                                                 inbox list filtered by MATCHED/BOOKED/UNMATCHED
                 ▼
STEP 2  resolveVendor → resolveBooking → resolveProvision         provision.lookup-directory / booking-cost lookup
                 │                                                 provision.matched-preview (re-check provisions)
                 ▼
STEP 3  checkInvoiceExistence (invoiceAlreadyExist)  ───────────  invoice-already-exist.data (SAME query, twin)
        matchProvision (digits-only compare)                      → if already booked in legacy, update the match
```

---

## STEP 1 — factura extraída → contabilizada (booked / matched / unmatched)  ✅ verified verbatim

| | WORKER | JOURNEYS |
|---|---|---|
| candidates | `fetch.unprocessed.invoices.ts:42-69` → `w1_fetch_unprocessed_invoices.sql` | — |
| write tag | `update.provision.status.ts:74-99` (insert/update `st_estatus`) | — |
| read badges | — | `invoices.service.ts:900-911` → `j1_factura_provision_state.sql` |
| inbox list by status | — | `invoices.service.ts:629-646` + `invoices.provision-match-filter.sql.ts` (dynamic; see STEP-1 note) |

- **Worker candidate set** = extracted AP invoices with **no** non-NULL tag yet
  (`NOT EXISTS … cd_identityBookingCosto IS NOT NULL`). The workflow always pages
  with `offset = 0` because each pass tags the front of the queue and shrinks it.
- **Journeys badges** = `j1` returns one row per (factura, booking-costo) with
  `st_estatus IN (0,1)` and `cd_identityBookingCosto IS NOT NULL`. To see
  **unmatched/unresolved**, query the same table for `cd_identityBookingCosto IS NULL`
  (these are excluded from `j1`).

## STEP 2 — provisions re-check (resolve vendor → booking → provision)  ⏳ cataloged, verify before running

The worker resolves these once; journeys re-runs the equivalents when you open
the provisions view. Twins:

| concern | WORKER | JOURNEYS |
|---|---|---|
| vendor from invoice participantes | `resolve.vendor.from.participantes.helper.ts:18-37` | `provision.lookup-directory.data.ts:169-181` |
| provision (booking-costo) candidates | `resolve.provision.helper.ts:43-51` (Kysely; `st_estatus<>'N'`, `st_enUso<>'S'`) | `provision.purchase-invoice-fpro.data.ts:206-240` (`st_enUso<>'S'`) |
| bookings from shipment signals | `resolve.booking.from.extracted.data.helper.ts:70-146` (6 sub-queries: ref / container / MBL / HBL / BL / MAWB) | resolved differently on FE (booking already in context) |
| matched-provision preview | — | `provision.matched-preview.data.ts:185-269` |

## STEP 3 — already booked in legacy? (the "booked on a legacy system" check)  ✅ verified verbatim

Near-identical `invoiceAlreadyExist` on both sides → `w2` / `j2`.

| | WORKER `invoice.already.booked.helper.ts` | JOURNEYS `invoice-already-exist.data.ts` |
|---|---|---|
| country (`cd_identityPaisResponsable`) | **param** (resolved upstream from provision) | **derived** from `TESch_BookingCosto` (step 0, single-country guard) |
| table names | `spp_ObtieneTablaPorPais` ×2 (detail + header) | same |
| link query | detail→header→`bpi`→`DatosRFC`, `st_cancelada<>'S'`, `st_estatus='A'` | **same**, plus selects `nu_internoFactura` (ALE-like headers only) + `cd_identityUsuario` |
| facturas returned | **first only** (`= cdIdentityFactura`) | **all** (`IN (distinctFacturaIds)`) |
| enrichment | `vw_FacturaMultiTenantGlobal` + `TCSch_Moneda` | same + `TCSch_Usuario` (booked-by name) |
| decision | `matchProvision` digits-only compare (`match.provision.ts`) | same helper semantics |

> Debug angle: if the worker said "booked" but journeys shows it differently (or
> vice-versa), the divergence is most likely (a) the **first-vs-all factura**
> difference, or (b) a different `cd_identityPaisResponsable` feeding
> `spp_ObtieneTablaPorPais` → different FPRO tables queried.

> **Dynamic, not country-pinned.** The FPRO purchase-invoice tables are
> country-specific and resolved at runtime: `spp_ObtieneTablaPorPais` returns a
> suffix, then the code builds `TESch_Factura{suffix}` (detail + header) and
> `cd_identityFactura{headerSuffix}` (FK) and interpolates them into the query.
> `w2`/`j2` replay this with `sp_executesql` — fill in `@cd_identityPais` (worker)
> or let `j2` derive it from `TESch_BookingCosto`, and the right tables are
> selected automatically. **No country is hardcoded.** Same applies to every
> ⏳ query below that touches an FPRO header/detail table
> (`provision.purchase-invoice-fpro.data.ts`, `provision.matched-preview.data.ts`,
> `invoice-already-exist.data.ts`).

---

## Full SELECT inventory (index — verify verbatim before running the ⏳ ones)

### Journeys side (`src/server-actions/api/...`)
- `invoices/invoices.service.ts` — inbox list (`:629`), tenant opts (`:701`), vendor opts (`:754`), detalles (`:789`), participantes (`:806`), **provision state `:900` ✅**
- `invoices/invoice-already-exist.data.ts` — **already-booked `:195` ✅**, country `:123`, vw `:243`, users `:259`, moneda `:274`
- `invoices/invoices.claim.guard.ts:15`, `invoices/invoices.discard.data.ts:48`
- `provision/provision.lookup-directory.data.ts` — `:97`, `:169`, `:278`, `:346`
- `provision/provision.booking-cost-invoice-lookup.data.ts:81`, `…sync.data.ts:52`
- `provision/provision.purchase-invoice-fpro.data.ts` — `:74`, `:99`, `:206`
- `provision/provision.matched-preview.data.ts:185`
- `provision/provision.book.service.ts:244`, `:326`
- `provision/provision.charge-concepts.data.ts:157`, `:200`, `:291`, `:327`
- `provision/provision.operations-executives.ts:58`

### Worker side (`src/activities/...`)
- `check-invoice-existence-activities/fetch.unprocessed.invoices.ts:42` ✅
- `check-invoice-existence-activities/update.provision.status.ts:37` (tag upsert lookup)
- `check-invoice-existence-activities/helper/resolve.vendor.from.participantes.helper.ts:18`
- `check-invoice-existence-activities/helper/resolve.provision.helper.ts:43`
- `check-invoice-existence-activities/helper/invoice.already.booked.helper.ts:119` ✅
- `check-invoice-existence-activities/helper/resolve.booking.from.extracted.data.helper.ts:70-146` (×6)
- `check-invoice-existence-activities/helper/factura.extraida.usuarios.helper.ts:34`, `:75`
- `check-invoice-existence-activities/helper/resolve.directory.helper.ts:184/192/212`
- `invoice-extraction-activities/fetch.classified.invoices.ts:47`
- `invoice-extraction-activities/store.extracted.invoice.ts:28`
- `invoice-extraction-activities/helper/fetch.invoice.extraction.tenant.context.ts:53/72/105`
- `invoice-extraction-activities/helper/fetch.sender.vendor.rankings.ts:54/86`
- `invoice-extraction-activities/store.invoice.participant.ts:32`

Legend: ✅ source-verified verbatim & runnable file written · ⏳ cataloged from scan, confirm against source before running.
