# The `resolve-entity` flow — endpoint, in-line call, storage

## Endpoint

- Use the **`resolve-entity`** endpoint instead of querying the directorio directly.
- Parameters: **entity name, tax ID, ERI, country code, city, address line 1.**
- At extraction time we usually **only have the entity name** (+ country code, which Krishna stores);
  tax ID / ERI typically absent. → ambiguity handling matters (see `03-ambiguity-scenarios`).

## Call it in-line, not as a new activity

- Krishna's argument (Carlos agreed): **don't add a new workflow activity.** Many workflows depend on the
  extraction record; an extra activity means everything downstream **waits** on it, and the number of
  future activities is unknown. So **call `resolve-entity` from the existing extraction code** and make
  that step agentic.

## AP-tag only

- Run the **agentic** resolution **only for the accounts-payable tag.** Commercial invoice / signature /
  unknown tags **skip** the agentic call (cost). Other tags can still run the non-agentic path.

## Resolve once, don't re-fetch the document

- Carlos initially wanted the agent able to **re-fetch the document**; Krishna pushed back on **cost**
  (re-processing the same document multiple times).
- Resolution: **resolve once at extraction time**, while inserting the `factura extraída` record, and
  **store the resolved IDs in the existing extraction object** — no new column on that table.
  - Store `set-identity-directorio` (entity ID) + `set-identity-directorio-direccion` (entity-address ID).

## `Factura Extraida Participantes` — revive it

- Table **exists but is not currently written to** (used by an earlier prototype, then dropped).
- Decision: **populate it in the same extraction step** (no second extraction of the invoice).
- Conceptual model:
  - `clasificación activo digital` → `identity directorio` = the **first attempt** (issuer directorio;
    kept here because the issuer's directorio can apply beyond invoices).
  - **`Factura Extraida Participantes` = the final attempt** for this agent, and the table where
    **provision creation** operates (it needs the entity-address ID).
- Record shape on the provision/table side is **1:1** — one `identity directorio` to one
  `identity directorio direccion` per participant row.

## Flow summary

1. Extract invoice → know it's AP, have entity name (+ country code).
2. In-line call `resolve-entity` (agentic, capped loop) → entity ID + entity-address ID.
3. Store IDs in the extraction object **and** populate `Factura Extraida Participantes`.
4. Provision creation reads Participantes; gate on entity ID + entity-address ID present.

## Backlinks
<!-- brain-nightly:start -->
- [[Notebooks/invoice-entity-resolution/00-index]] — "[[notes/02-resolve-entity-endpoint]] — endpoint params, in-line call, AP-only, storage decisions"
<!-- brain-nightly:end -->
