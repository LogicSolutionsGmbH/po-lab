# Logic Heroes — Claude demo kit

Drive the Logic Heroes API end to end **by talking to Claude**. Open a Claude
session in this folder and say what you want — "create a shipment and request
`ltl_pickup_origin` from tenant `schryver`", "accept the request in my inbox" —
and Claude orchestrates the example scripts for you.

Two bundled skills cover the two sides of the handshake:

- **`heroes-assigner`** — create a shipment, request a service from a tenant,
  re-initiate after a rejection, track what you sent.
- **`heroes-taker`** — read your inbox, accept or reject a request, attach a
  confirmation.

Both share `.claude/references/handshake-flow.md` (setup, payload convention,
state machine). Under the hood they run the standalone TypeScript scripts in this
folder — see **`API-SCRIPTS.md`** for the raw CLI.

## Quickstart

1. **Download** this folder (`heroes-demo-kit`).

2. **Add credentials.** Copy the template and fill it in:
   ```bash
   cp .env.example .env
   # edit .env:
   #   API_URL        e.g. http://localhost:3401/api   (keep the /api suffix)
   #   MAKER_API_KEY  the assigner's key
   #   TAKER_API_KEY  the taker's key (may equal MAKER for a self-request demo)
   ```

3. **Add a payload (optional).** A payload is the document attached to a request.
   Two examples ship in `payloads/` (`shipment-booking/booking.json`,
   `accept-handshake/confirmation.xml`). To use your own, make a new folder under
   `payloads/` holding **exactly one file** and reference it by name when you ask.

4. **Start Claude in this folder** and just ask. For example:
   > Create a shipment and send a service request for `ltl_pickup_origin` to
   > tenant `schryver`, attaching the booking payload.

   Claude picks the `heroes-assigner` skill, runs `create-shipment.ts`, and reports
   the `journeyId` / `serviceId` / `eventId`. Then:
   > Show my incoming requests and accept that one with provider ref `PROV-12345`.

   Claude switches to `heroes-taker` and accepts. Ask it to verify and it runs
   `show-service.ts`.

No build or install step is required — the scripts run via `npx tsx`, which
fetches `tsx` on the fly. `npm install` is optional.

## What's in here

```
heroes-demo-kit/
├── README.md              ← you are here (demo quickstart)
├── API-SCRIPTS.md         raw CLI reference for the scripts
├── .env.example           credential template → copy to .env
├── .claude/
│   ├── skills/
│   │   ├── heroes-assigner/SKILL.md
│   │   └── heroes-taker/SKILL.md
│   └── references/handshake-flow.md
├── payloads/              example documents (one file per folder)
├── create-shipment.ts  initiate-handshake.ts  list-requests.ts
├── accept-strategy.ts  reject-strategy.ts     show-service.ts
└── lib.ts  package.json  tsconfig.json
```

## Shipping to a single-role client

For the demo, keep both skills — one machine holds both keys and plays both
sides. When you hand the kit to a real client who is only one tenant, ship just
their role's skill (and fold `references/handshake-flow.md` into that skill's
folder), plus only the key they hold.
