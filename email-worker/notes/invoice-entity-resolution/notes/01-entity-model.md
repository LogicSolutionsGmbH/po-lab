# Entity model (the directorio)

From Carlos's on-screen walkthrough (2026-06-05).

## Global directory + address reuse

- There is a **global directory** of companies. A country/office (e.g. Germany) **creates** a company once.
- Because a company is often a group, when **another (sister) office** needs the same company, it does
  **not** create a new entity — it **reuses the same entity** (`identity directorio`) and just **adds its
  own address** (`identity directorio direccion`).
- So **each address belongs to a tenant/office**, but multiple addresses roll up to **one entity**.

## Rules

- **All addresses under one entity = same legal entity, same country.**
  - You **cannot** attach multiple countries to the same entity ID — that would imply a different legal
    entity. (Hard rule.)
  - Within a country you **can** have multiple addresses / branches and still be the same legal entity
    (example: MSC with branches on two sides of Switzerland = same legal entity).
- A company can have **more than one active address** for the same entity (e.g. Brazil had two; one
  inactive — but two active is also fine, addresses can differ slightly).

## Branches vs parent — why provisions attach to the branch

- Provisions are created **for the branch**, not the parent, because **each branch can have its own
  accounts-payable / accounts-receivable** ("accounting repository"): different statements of account,
  different administrative people. Invoices are sent to a specific branch.

## The 1:1 invoice rule (key simplification)

- An invoice is **always one company + one address** — always. Never one company with multiple addresses.
  *"An invoice is never going from multiple buildings. It's just one building issuing the invoice."*
- So per invoice we resolve to **one entity ID + one entity-address ID** (1:1).
- We fetch **both**: the **parent entity ID** and the **specific branch address ID** mentioned on the invoice.

## Why a separate normalized table (not extra columns)

- An invoice involves **at least two companies** (tenant + recipient; possibly shipper + consignee).
  Adding entity/address columns inline would mean repeating company data many times.
- Answer to "why not just two columns": **normalization.** Hence `Factura Extraida Participantes`
  (see `02-resolve-entity-endpoint`).

## Backlinks
<!-- brain-nightly:start -->
- [[Notebooks/invoice-entity-resolution/00-index]] — "[[notes/01-entity-model]] — global directory, address reuse by sister offices, branches, 1:1 invoice rule"
<!-- brain-nightly:end -->
