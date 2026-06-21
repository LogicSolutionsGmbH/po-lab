# Logic Heroes API — example scripts

Small, **standalone** TypeScript scripts that show how to drive the Logic Heroes
API end to end: create a shipment with a service, run the handshake between two
tenants, and attach documents along the way.

Each script is a single file you can read top to bottom in a minute. There is no
build step and nothing to clone — copy this folder anywhere and run it.

## Requirements

- **Node.js 18+** (uses built-in `fetch`, `FormData`, `Blob` — no dependencies).
- Two API keys: a **maker** (assigner) and a **taker** (assignee). They can be
  the same key if you want to demo a self-request.

## Setup

```bash
cp .env.example .env
# edit .env: set API_URL, MAKER_API_KEY, TAKER_API_KEY
```

Run any script with `npx tsx` (npx fetches `tsx` on the fly — no install needed):

```bash
npx tsx create-shipment.ts ./payloads/shipment-booking --target schryver
```

Or, if you'd rather install once: `npm install` then `npm run create-shipment -- ...`.

## Payload folders

A "payload" is the document attached to an event. Each example folder holds
**exactly one file** — JSON, XML, or anything else; the content type is inferred
from the extension. Small text files (≤ 8 KB) ride inline on the event; larger or
binary files are uploaded as a multipart attachment automatically.

- `payloads/shipment-booking/booking.json` — booking sent by the maker
- `payloads/accept-handshake/confirmation.xml` — confirmation sent by the taker

## The handshake flow

```
maker                                   taker
  │  create-shipment  (journey+service+INITIATED)
  │ ───────────────────────────────────▶ │
  │                          list-requests --direction incoming
  │                                       │  (finds the serviceId)
  │ ◀─────────────────────────────────── │  accept-strategy / reject-strategy
  │  show-service  (verify final state)
```

## The scripts

| Script | Role | What it does |
| --- | --- | --- |
| `create-shipment.ts` | maker | Create a SHIPMENT journey → create a service → INITIATE handshake to a target → attach payload. The full first case, one command. |
| `initiate-handshake.ts` | maker | INITIATE a handshake on an **existing** service. |
| `list-requests.ts` | both | Discover requests. `--direction incoming` (taker inbox) or `outgoing` (maker's sent). |
| `accept-strategy.ts` | taker | Accept a handshake by service ID with `--provider-ref`, attach payload. |
| `reject-strategy.ts` | taker | Reject a handshake by service ID (optionally `--reason`). |
| `show-service.ts` | both | List strategy instances on a service to verify the state. |

### End-to-end example

```bash
# 1. Maker creates the shipment and initiates the handshake
npx tsx create-shipment.ts ./payloads/shipment-booking --target schryver \
    --service-key ltl_pickup_origin
#   → prints journeyId, serviceId, eventId

# 2. Taker finds the request
npx tsx list-requests.ts --direction incoming

# 3. Taker accepts (use the serviceId from step 1/2)
npx tsx accept-strategy.ts <serviceId> --provider-ref PROV-12345 \
    ./payloads/accept-handshake

# 4. Either side verifies the result
npx tsx show-service.ts <serviceId> --role maker
```

## Notes

- `--service-key` must match a service template seeded in your environment
  (e.g. `ltl_pickup_origin`, `OCEAN_FREIGHT`). Ask your Logic Heroes contact for
  the keys available to you.
- Only the **target tenant** of a handshake can accept or reject it — the API
  enforces this, and the scripts surface the server's message if you try
  otherwise.
- After a `REJECTED`, the maker can run `initiate-handshake.ts` again to retry
  with the same or a different target.
