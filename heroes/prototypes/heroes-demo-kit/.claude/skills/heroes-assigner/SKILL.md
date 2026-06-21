---
name: heroes-assigner
description: >-
  Create a Logic Heroes shipment and send a service request (handshake) to
  another tenant, track requests you have sent, and re-initiate after a
  rejection. Use when the user wants to create a shipment, request a service
  from a tenant or carrier, initiate or re-initiate a handshake, attach a
  booking document, or check the status of requests they sent (the assigner /
  maker side).
---

# Logic Heroes — assigner (maker) side

You drive the **assigner** half of the handshake: create a shipment, open a
service, and request it from a target tenant. You authenticate with the
`MAKER_API_KEY` in `.env`.

**Before doing anything, read `.claude/references/handshake-flow.md`** for the
shared setup, the payload-folder convention, the state machine, and tenant/
service-key rules. Don't repeat that knowledge here — apply it.

## Create a shipment + request a service from tenant X

This is the flagship one-command path. It creates a SHIPMENT journey, creates a
service on it, and initiates the handshake toward the target, attaching the
single file in the payload folder.

```bash
npx tsx create-shipment.ts <payload-folder> --target <tenantKey> \
    [--service-key <key>] [--name <eventName>] [--lo-code <UNLOCODE>]
```

Example — request `ltl_pickup_origin` from tenant `schryver`, attaching the
booking:

```bash
npx tsx create-shipment.ts ./payloads/handshake/request-service --target schryver \
    --service-key ltl_pickup_origin
```

The script prints `journeyId`, `serviceId`, and `eventId`. **Capture the
`serviceId`** — every later step (accept, reject, verify) is keyed by it. Report
it back to the user.

If the user gives you their own document, create a new folder under `payloads/`,
put the single file in it, and pass that folder (see the payload convention in
the shared reference).

## Re-initiate on an existing service

When the journey/service already exists (e.g. after a `REJECTED`, or one created
earlier), open a fresh handshake without creating a new shipment:

```bash
npx tsx initiate-handshake.ts <serviceId> --target <tenantKey> \
    [<payload-folder>] [--name <eventName>] [--lo-code <UNLOCODE>]
```

## Track what you've sent

```bash
npx tsx list-requests.ts --direction outgoing
```

Lists the handshakes you've initiated and their current step. Use it to confirm a
request went out, or to find a `serviceId` you lost.

## Verify the outcome

```bash
npx tsx show-service.ts <serviceId> --role maker
```

Confirm the service moved `INITIATED → ACCEPTED` (taker accepted) or `REJECTED`
(taker declined — you may re-initiate to another tenant).

## Boundaries

You cannot accept or reject — only the **target tenant** can (the taker side,
handled by the `heroes-taker` skill). If the user asks to accept/reject, that's
the taker role.
