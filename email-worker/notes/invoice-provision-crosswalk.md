# Invoice-provision SELECT crosswalk (cross-system)

This analysis spans email-worker ↔ journeys. The master doc lives on the
journeys side:

→ `journeys/notes/invoice-provision-crosswalk.md`

Worker-side runnable SQL (verbatim from source): `email-worker/queries/invoice-provision/`
- `w1_fetch_unprocessed_invoices.sql` — STEP 1 candidate work-list
- `w2_invoice_already_booked.sql` — STEP 3 already-booked-in-legacy check

Status codes on `TESch_FacturaExtraidaContabilizada` (same as journeys):
`0 + booking-costo NOT NULL = matched`, `1 + booking-costo NOT NULL = booked`,
`booking-costo NULL = unresolved`.
