---
name: heroes-taker
description: >-
  Triage incoming Logic Heroes service requests and accept or reject a handshake
  addressed to you, attaching a confirmation document. Use when the user wants to
  see their inbox of incoming requests, accept a service request with a provider
  reference, reject one with a reason, or verify a request they received (the
  taker / assignee side).
---

# Logic Heroes — taker (assignee) side

You drive the **taker** half of the handshake: read the inbox of requests
addressed to you and accept or reject them. You authenticate with the
`TAKER_API_KEY` in `.env`.

**Before doing anything, read `.claude/references/handshake-flow.md`** for the
shared setup, the payload-folder convention, the state machine, and tenant/
service-key rules. Don't repeat that knowledge here — apply it.

## See your inbox

```bash
npx tsx list-requests.ts --direction incoming
```

Lists the handshakes addressed to you with their `serviceId` and current step.
**Grab the `serviceId`** of the request you want to act on — accept and reject
are keyed by it.

## Accept a request

```bash
npx tsx accept-strategy.ts <serviceId> --provider-ref <ref> \
    [<payload-folder>] [--name <eventName>] [--lo-code <UNLOCODE>]
```

`--provider-ref` is your own reference for the accepted service (required). The
optional payload folder attaches a confirmation document. Example:

```bash
npx tsx accept-strategy.ts <serviceId> --provider-ref PROV-12345 \
    ./payloads/accept-handshake
```

## Reject a request

```bash
npx tsx reject-strategy.ts <serviceId> [<payload-folder>] \
    [--reason <text>] [--name <eventName>] [--lo-code <UNLOCODE>]
```

Pass a short `--reason` (recorded inline as the event text) or a payload folder
with a rejection document. A folder takes precedence over `--reason`. Rejecting
clears the assignment so the assigner can retry with another tenant. Example:

```bash
npx tsx reject-strategy.ts <serviceId> --reason "No capacity this week"
```

## Verify

```bash
npx tsx show-service.ts <serviceId> --role taker
```

Confirm the service now reads `ACCEPTED` or `REJECTED`.

## Boundaries

You can only act on requests where **you are the target tenant** — the API
enforces this and the script surfaces the server's message otherwise. You cannot
create shipments or initiate handshakes; that's the assigner role (the
`heroes-assigner` skill).
