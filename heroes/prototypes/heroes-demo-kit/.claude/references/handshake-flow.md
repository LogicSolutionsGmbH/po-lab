# Logic Heroes — handshake flow (shared reference)

Role-neutral knowledge shared by the `heroes-assigner` and `heroes-taker` skills.
Read this once at the start of a session before driving the API.

## What the demo does

Two tenants exchange a **service request** over the Logic Heroes API. The
*assigner* (maker) creates a shipment and requests a service from another tenant;
the *taker* (assignee) accepts or rejects it. The state machine is a HANDSHAKE:

```
assigner (maker)                              taker (assignee)
  │  create-shipment   journey + service + INITIATED
  │ ───────────────────────────────────────────▶ │
  │                       list-requests --direction incoming
  │                                               │  (reads the serviceId)
  │ ◀─────────────────────────────────────────── │  accept-strategy / reject-strategy
  │  show-service   verify INITIATED → ACCEPTED / REJECTED
```

Step keys: `INITIATED` → `ACCEPTED` **or** `REJECTED`. After `REJECTED`, the
assigner can `initiate-handshake` again toward the same or a different tenant.

## Setup (do this before any script)

1. Credentials live in `.env` (copy from `.env.example`). All scripts read it:
   - `API_URL` — base URL, **includes the `/api` suffix** (e.g. `http://localhost:3401/api`).
   - `MAKER_API_KEY` — the assigner's key (creates journeys/services, initiates).
   - `TAKER_API_KEY` — the taker's key (accepts/rejects). May equal the maker key
     for a self-request demo.
2. No install step is required — every script runs with `npx tsx <script>.ts`
   (npx fetches `tsx` on the fly). `npm install` is optional.

## Payload convention

A "payload" is the document attached to an event. Each payload **folder holds
exactly one file** — JSON, XML, PDF, anything. The content type is inferred from
the extension. Files ≤ 8 KB ride inline on the event; larger/binary files are
uploaded as a multipart attachment automatically.

To use a client's own document: create a new folder under `payloads/`, drop the
single file in, and pass that folder path to the script. Shipped examples:
Payloads are grouped by strategy, so other strategies can sit beside `handshake/`:
- `payloads/handshake/request-service/booking.json` — booking sent by the assigner
  when requesting the service.
- `payloads/handshake/accept/confirmation.xml` — confirmation sent by the taker on accept.

## Verifying state (either role)

```bash
npx tsx show-service.ts <serviceId> --role maker|taker
```
Lists the strategy instances on a service with their current step, so you can
confirm a handshake landed where expected.

## Keys & tenants

- `--target <tenantKey>` is the **tenant key** of the counterparty (e.g. `schryver`).
- `--service-key <key>` must match a service template seeded in the environment
  (e.g. `ltl_pickup_origin`, `OCEAN_FREIGHT`). Defaults to `OCEAN_FREIGHT`.
- Ask your Logic Heroes contact for the tenant keys and service keys available to you.

## Permission rule

Only the **target tenant** of a handshake may accept or reject it — the API
enforces this server-side and the scripts surface the server's message if you try
otherwise.
