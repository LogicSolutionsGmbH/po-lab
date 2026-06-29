# Webhooks: Tenant-level vs Service-instance-level

> **Ideation** · seeded from the 2026-06-26 Carlos ↔ Valeriy strategy call.
> Status: **open question, not decided.** Both of us agreed there is "a sense in both." This page exists so Carlos can *experience* Valeriy's position hands-on, and so we have a shared vocabulary before Arturo touches code.

---

## 0. TL;DR

We need outbound webhooks (Heroes POSTing data to *your* systems when something happens). There are two shapes on the table, and **they are not mutually exclusive**:

| | **Tenant-level (universal)** — Carlos | **Service-instance-level (granular)** — Valeriy |
|---|---|---|
| You declare it… | **once**, for your whole tenant | **every time** you create an instance of a service |
| It fires for… | *everything* in your tenant (any service, any request, any event) | only events of **that one instance** |
| Heroes posts to… | one endpoint you set up ahead of time | whatever endpoint you supply at creation — Heroes can't know it in advance |
| Routing/filtering happens… | **on your side**, after delivery | **at declaration time**, per instance |
| Best for… | "mirror everything into my system", audit, notifications | bespoke flows where each instance goes somewhere different |

The point of friction in the call was **not** "which one wins." It was that Carlos kept hearing the tenant-level model as *sufficient*, and Valeriy kept saying *there's a second thing you can't collapse into it*. By the end Valeriy said "I start to understand what you want… but at the same time we still have the concept of working with a particular instance of the service." That second thing is what this page makes tangible.

---

## 1. What the existing Heroes code already tells us

This debate isn't abstract — Heroes **already** answers the same question on the *inbound* side, and the answer it shipped is **granular**.

### Inbound (today, in `main`): one dedicated webhook per source
`apps/api/src/modules/pipelines/routes/webhooks/`:

- `POST /api/pipelines/webhook/wakeo`   → `wakeo.ts` — own token (`config.webhooks.wakeoToken`), own Zod schema, own transform `transformWakeoPayload()`
- `POST /api/pipelines/webhook/traxon`  → `traxon.ts` — own token, own schema, own transform
- `POST /api/pipelines/webhook/hapag-iot` → `hapag-iot.ts` — own token, own parser

There is **no single generic `/webhook` that figures out the sender**. Each integration gets its **own URL, own secret, own payload shape, own transform**. Tenant is resolved per call (Wakeo by subscription UUID, Traxon by AWB, Hapag by container ref). This is exactly Valeriy's instinct — *granularity per relationship* — already proven in production for data coming **in**.

**Valeriy's outbound proposal is the mirror image of a pattern Heroes already runs inbound.** That's the strongest argument that the granular model isn't over-engineering: we already live with it and it works.

### The domain the outbound webhook attaches to
From `packages/database/src/schemas/journeys/journeys.tables.ts` and `packages/services/src/journeys/`:

- **A "service" row IS the instance.** `service` (`id`, `serviceKey`, origin/destination) is a concrete shipment/handshake, not a catalog entry. `serviceKey` points at the template (`templateService`). So **"instance of a service" = one `service` row + its `strategyInstance` + its `serviceParticipants`.**
- **Participants & roles**: `serviceParticipants` (`serviceId`, `tenantId`, `role` = `assigner | assignee | observer`). A service is a **multi-party contract** — the same `serviceKey` (say `handshake`) is used by *different tenants with different counterparts* every time. This is the heart of Valeriy's "same service, different instances, different endpoints."
- **Events** (`event` + `serviceEvent` + `strategyEvent`): an event carries `name`, `eventAt`, `eventType` (`ACT`/`PLN`/`EST`), `sourceTenantId`, and — crucially — `strategyEvent.targetTenantId`: **the event already knows which tenant it is directed at.** That field is the natural routing key for *either* webhook model.
- **Strategies are code-level** (`strategies/registry.ts`): `HANDSHAKE` = `INITIATED → ACCEPTED | REJECTED | EXPIRED`, transitions defined in code; the DB tables mirror it. (Relevant to Valeriy's separate "seed-data vs code package" question — the code registry is already the source of truth.)
- **No outbound webhook / event-subscription concept exists yet.** The only "subscription" today is `providerSubscription` — *inbound* visibility tracking (Wakeo/Hapag/etc.), not "POST my events to a URL." So this is a genuine green-field gap, not a refactor.

**Takeaway for the doc reader:** when we say "service-instance webhook," in code that means *"a row that binds (this `service.id`, this/these event types) → (this URL, this payload shape), created at the moment the `strategyInstance` is created."*

---

## 2. The two positions, steel-manned

### 2a. Carlos — universal tenant-level webhook
**Claim:** "I want one universal tenant-level webhook. Any service created, any service request that comes in from another tenant to my tenant — anything — lands on *one* endpoint I control. I don't want to set up a cron to mindlessly poll for new requests."

**What it's genuinely good for** (Valeriy actually conceded these):
- **Mirroring**: "you want your secondary system to receive the same data without the full integration." One hook, everything flows.
- **Notifications / audit**: a firehose into your own ops tooling — "what's going on in Heroes" → your inbox/Slack/log.
- **Low setup cost**: declare once, never think about it again.

**Where it strains:** when two different flows in your tenant need to go to **two different places** with **two different shapes**, the universal hook delivers *both to the same door*, and now **you** rebuild the routing logic on your side for every event — including events you never cared about.

### 2b. Valeriy — service-instance-level webhook
**Claim:** "It's not the webhook for the service, it's for the **instance** of the service. When the instance is created you declare *what you want to happen and where*. Different tenants use the same service in different ways, with different participants, and want events posted to different endpoints. Even two instances of the same service: one puts the service ID in the URL, the other doesn't. **So you never know where they'll point the data** — Heroes can't precompute it; it must be declared per instance."

**The mechanism is dead simple** (this is important — it is *not* complex per call): "webhooks are a universal thing — whatever comes, the same event payload, you dump to the URL. Technically identical every time. What differs is **which URL** and **(optionally) what shape**." The intelligence is **not** in the firing; it's in the **binding decided at creation time**.

**What it's genuinely good for:**
- **Per-counterpart routing**: Schryver↔CargoCompass pickup events → your WMS; Schryver↔customs-broker events → an email/SFTP. Same `serviceKey`, different destinations, decided per deal.
- **No wasted operations / no re-implementing the router**: Heroes only sends you the events you bound; you don't pay (in make.com ops, in code, in dropped-filter bugs) to throw the rest away.
- **Self-describing URLs**: the initiator can bake the service ID, a token, a customer code into the endpoint *for that instance* — something a tenant-wide endpoint structurally cannot do.

**Where it strains:** more setup — you (or your agent/recipe) must register the hook **every time** you spin up an instance. For a tenant that just wants "tell me about everything," that's friction the universal model removes.

### 2c. Where they actually meet (Valeriy's closing position)
> "Both can live. They can even be used at the same time. Tenant-level: very granular control of what's going on inside your tenant, post to your systems. Service-instance level: when you *don't* want the catch-all, you point this instance's events to whatever endpoint, only for these things."

So the real design isn't A-vs-B. It's: **ship the tenant-level firehose for the mirror/notify use case, AND ship instance-level bindings for bespoke routing — and let them run together.** The open question Valeriy flagged is purely *"do we also need the service-*instance* tier, or is tenant-level + per-event-type filtering enough?"* He explicitly said "I may be wrong about having it on the service level."

### 2d. A second axis hiding in the conversation: **push vs pull**
Carlos's "I don't want a cron mindlessly polling" is a *different* lever from tenant-vs-instance. Valeriy caught this: "that's a different kind of webhook — pull-based vs the event-driven push." Keep these orthogonal:

|  | **Push** (Heroes calls you) | **Pull** (you ask Heroes) |
|---|---|---|
| Tenant-level | one URL, all your events arrive | poll "what's new in my tenant" on a timer |
| Instance-level | per-instance URL, that instance's events arrive | poll "what's new on instance X" |

The hands-on labs below are about **push**, because that's the part Carlos wanted to *feel*. Pull is the demo-kit's current "drop a file in the `payloads/` folder" stand-in.

---

## 3. Experience Valeriy's point of view — hands-on labs

Carlos: do these in order. Each lab is something you can actually click through in **make.com** (or **n8n**, notes inline). The goal is not to build the real thing — it's to *feel* the exact moment the universal model stops being enough. ~30–45 min total. You need: a free make.com account, and optionally a browser tab on **https://webhook.site** (gives you a throwaway URL that shows you any payload posted to it — zero setup).

> Mental model: **a webhook URL is the unit of granularity.** Every separate destination = a separate URL. Hold onto that; it's the whole argument.

### Lab 0 — Make a webhook URL exist (5 min)
1. make.com → **Create a new scenario** → add the **Webhooks ▸ Custom webhook** module → **Add** → name it `tenant-firehose` → it generates a URL like `https://hook.eu2.make.com/abc123…`. Copy it.
2. Click **Run once** (it now listens).
3. In a terminal or Postman, POST a fake Heroes event to it:
   ```bash
   curl -X POST 'https://hook.eu2.make.com/abc123…' \
     -H 'Content-Type: application/json' \
     -d '{"event":"handshake.initiated","service":{"id":"SVC-1001","serviceKey":"handshake"},
          "from":"schryver","to":"cargocompass","payloadRef":"booking.json"}'
   ```
4. See it land in make.com. **That URL is your tenant-level endpoint.** (n8n: the **Webhook** node does the same; webhook.site: just paste its URL and POST — you'll see the body instantly.)

> 🔑 You just built **Carlos's model**: one URL, Heroes dumps everything here.

### Lab 1 — Live inside the universal model until it hurts (10 min)
Keep the single `tenant-firehose` URL. Now POST **four different** events to it, as if your whole tenant flows through one door:
```
{"event":"handshake.initiated","service":{"id":"SVC-1001","serviceKey":"handshake"},"to":"cargocompass"}
{"event":"handshake.accepted","service":{"id":"SVC-1001","serviceKey":"handshake"},"to":"cargocompass"}
{"event":"document.uploaded","service":{"id":"SVC-2002","serviceKey":"customs_clearance"},"to":"acme-broker"}
{"event":"visibility.milestone","service":{"id":"SVC-3003","serviceKey":"seafreight_visibility"}}
```
Now do the realistic business task: **"pickup/handshake events must go to our WMS; customs document events must go to the broker's email; visibility milestones we ignore."**

In make.com you now have to add a **Router** after the webhook, plus a **Filter** on each branch (e.g. `serviceKey = handshake` → WMS; `serviceKey = customs_clearance` → email; everything else → trash). Build it.

**Feel these costs (this is the lab's whole point):**
- Every event — including the visibility ones you throw away — **consumed a make.com operation**. You pay to receive garbage.
- The **routing logic now lives in your make.com scenario.** You are re-implementing, by hand, a decision Heroes already knew (`strategyEvent.targetTenantId`, `serviceKey`).
- Get one filter condition wrong → events **silently vanish**. No error, just missing.
- New counterpart next month with a different destination? You go **edit the central router** and risk breaking the existing branches.

> This is precisely what Valeriy means by "you'd have to work on having… the granularity" — in the universal model the granularity doesn't disappear, it just **moves onto your plate, after delivery.**

### Lab 2 — Build Valeriy's model and feel the difference (10 min)
Now invert it. Make **two separate scenarios**, each with its **own** Custom-webhook URL:
- Scenario **A** `instance-cargocompass-wms` → URL-A → action: post to a Google Sheet called "WMS".
- Scenario **B** `instance-broker-email` → URL-B → action: send an email.

Pretend you're **creating two service instances** in Heroes and, *at creation time*, you register the destination:
- Instance **SVC-1001** (Schryver ↔ CargoCompass, `handshake`): register **URL-A**.
- Instance **SVC-2002** (Schryver ↔ broker, `customs_clearance`): register **URL-B**.

Now POST `SVC-1001`'s events to **URL-A** and `SVC-2002`'s to **URL-B** directly (that's what Heroes would do for you).

**Feel the difference:**
- **No Router. No Filter. No wasted operations.** Each scenario receives only what it was bound to.
- The routing decision happened **once, at creation, by the person who knew the deal** — not centrally, not after the fact.
- The two scenarios **can't break each other.** Add a third counterpart → add a third scenario → register URL-C. Nothing existing is touched.

> 🔑 You just built **Valeriy's model.** Notice the firing was *identical* ("dump the event to a URL") — the only thing that changed is **the binding was made per instance, up front.**

### Lab 3 — The "you never know the URL" proof (5 min)
Valeriy's sharpest point: Heroes literally **cannot** precompute the endpoint, because it's the initiator's free choice per instance.
- For **SVC-1001**, register a plain URL-A.
- For **SVC-2002**, register **URL-B with the service ID baked in**: `https://hook.eu2.make.com/def456…?service=SVC-2002&customer=ACME`.
- POST each instance's event to its registered URL.

In Scenario B, read `service` and `customer` straight **off the query string** — the initiator encoded routing *into the URL itself*. A single tenant-wide endpoint structurally can't carry per-instance identity like this. This is the concrete meaning of *"one instance uses the ID in the URL, another doesn't — so you never know where they'll point the data."* **That unknowability is the argument for declaring per instance.**

### Lab 4 — Prove they coexist (10 min)
Final move — run **both at once**, which is where Valeriy landed:
- Keep `tenant-firehose` (Lab 0) wired to a "log EVERYTHING to a master sheet" scenario → this is your **mirror/audit** (Carlos's legitimate use case).
- Keep the per-instance URLs from Lab 2 for the flows that need **bespoke routing** (Valeriy's case).
- POST an `SVC-1001` event to **both** URL-A *and* the firehose.

You now see it land in the audit log **and** the WMS, via two independent mechanisms that don't fight. **That's the synthesis:** tenant-level is the *catch-all mirror*; instance-level is *surgical routing*. Different jobs.

### Optional Lab 5 — push vs pull (5 min)
In make.com add a **Scheduler**-triggered scenario that calls a (mock) `GET /services?status=new` every 15 min instead of receiving a webhook. Feel the lag and the wasted empty polls — this is the "mindless cron" Carlos wants to kill. Conclusion: **push webhooks (Labs 1–4) are the answer to polling; that's a separate win from the tenant-vs-instance choice.**

---

## 4. Translating the labs back to Heroes design

What each make.com concept maps to in the real system:

| In the lab (make.com) | In Heroes |
|---|---|
| A Custom-webhook URL | A destination endpoint a tenant registers |
| "Run once / listening" | An active webhook binding |
| The **Router + Filters** you built in Lab 1 | Logic Heroes would own this if tenant-level-only — or push it onto every tenant |
| Registering URL-A at instance creation (Lab 2) | A `serviceWebhook` row: `(serviceId, eventTypes[], url, payloadTemplate?)` created alongside the `strategyInstance` |
| Query-string identity (Lab 3) | The initiator's free-form endpoint — proof Heroes must store, not derive, the URL |
| Firehose + per-instance together (Lab 4) | `tenantWebhook` (one per tenant, all events) **and** `serviceWebhook` (per instance) coexisting |

**The firing engine is the same for both** and is trivial: on event creation, look up any matching bindings (tenant-level for the source/target tenant; instance-level for that `service.id`), POST the event body to each. The design weight is **entirely in the binding model**, not the dispatch.

### Open questions for the reconvene
1. **Do we ship the instance tier at all, or is `tenantWebhook` + per-event-type filter enough?** (Valeriy: "I may be wrong about the service level.") The labs argue the instance tier earns its keep exactly when *destination differs per counterpart* — which is the Heroes network's whole premise.
2. **Payload shape**: raw event body only, or a per-binding transform/template? (Valeriy leaned "same structure, maybe transformed — but the body, not invented.")
3. **Who registers the instance hook** in the agent/recipe flow — is it one more step the `heroes-assigner` skill performs at creation? (Ties directly into the demo kit + the "recipes" concept.)
4. **Retries / failure / security**: signing secret per binding (mirror the inbound `wakeoToken` pattern), retry policy, dead-letter. Inbound already does per-endpoint tokens — reuse that shape.
5. **Naming**: Valeriy floated "channels" to avoid clashing with the existing inbound `providerSubscription` "subscription." Worth settling so we don't overload the word.

---

## 5. References
- Source of this page: 2026-06-26 Carlos ↔ Valeriy call (transcript in KB).
- Inbound webhook precedent: `apps/api/src/modules/pipelines/routes/webhooks/{wakeo,traxon,hapag-iot}.ts`.
- Domain model: `packages/database/src/schemas/journeys/journeys.tables.ts` (`service`, `serviceParticipants`, `event`, `serviceEvent`, `strategyEvent.targetTenantId`).
- Strategies (code-level): `packages/services/src/journeys/strategies/registry.ts`.
- Demo kit (the prototype that surfaced all this): `prototypes/heroes-demo-kit/`.

*Next: Carlos runs Labs 1–4, drops findings/screenshots under "Notes from running the labs" below, then we reconvene to decide Q1.*

## Notes from running the labs
_(to be filled in by Carlos)_
