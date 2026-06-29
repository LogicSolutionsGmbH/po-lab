# Heroes Agent Workspace — Design

A file-based interface where a human deposits triggers and context, an agent does the
logistics work against the Logic Heroes API, and a read-only dashboard shows the agent
working and surfaces human-in-the-loop moments. It **mimics production for
experimentation and demonstration** — not a production system.

- Vocabulary: see [CONTEXT.md](./CONTEXT.md).
- What's in / out: see [SCOPE.md](./SCOPE.md).
- Key decisions: see [docs/adr/](./docs/adr/).

## Principles

1. **Filesystem = I/O backend, not storage.** Heroes is the system of record; the
   Workspace is input (deposits) and a disposable output projection. → [ADR-0001](./docs/adr/0001-filesystem-as-interface-not-storage.md)
2. **Symmetric peers; maker/taker is per-move, not per-company.** → [ADR-0002](./docs/adr/0002-symmetric-peers-role-per-move.md)
3. **The agent derives the move.** It reads a deposit, derives the protocol-legal step
   from the railway maps, and calls Heroes. The human deposits and decides; the railway
   constrains the agent from illegal moves.

## Data flow

```
  human                      agent (terminal)                     human
  deposit  ──▶  intake  ──▶  interpret (channel vs content)
                            derive legal move from railway map
                            call Heroes API  ──────────────▶  Heroes (system of record)
                            write OUT projection  ──▶  dashboard/data/*.json
                                                              │
                                                       dashboard (static, read-only)
                                                       polls projection, renders,
                                                       surfaces pending decisions
                                                              │
                            ◀── decision via terminal (quick) / intake (content) ──┘
```

The dashboard makes **no** API calls; it only renders what the agent wrote. Reactivity is
the dashboard polling the filesystem.

## Peers & identity

One company = one **Workspace** = one tenant identity (one API key) = the **full**
capability set (both skills). The demo runs **N peer Workspaces** (each its own Finder +
terminal), interacting through real Heroes as equals. There is no "maker Workspace" or
"taker Workspace" — role is decided per move.

## Filesystem layout (per peer)

```
<workspace-root>/                 # one peer = one tenant
  self/                           # identity + config: tenant-key, API key, base URL; standing context
  counterparties/
    <tenant-key>/
      intake/                     # triggers FROM this counterparty (channel); + processed/ archive
      context/                    # standing reference for this relationship (terms, notes)
  intake/                         # root catch-all: first contact from an UNKNOWN sender only
  journeys/                       # thin shipment index → pointers to services scattered across counterparties
  dashboard/                      # static HTML/CSS/JS
    data/                         # OUT projection the agent writes; dashboard's only data source
  .claude/                        # the kit: skills + railway maps + CLAUDE.md (triage behavior)
```

Heroes-side objects — services, events, attachments, assets, subscriptions, strategy
position — are **not** stored here; the agent touches them by reference and renders a
disposable view into `dashboard/data/`.

## The two skills

Named for the business roles (= Heroes assigner/assignee):

- **maker** (assigner) — bring the business and assign it: HANDSHAKE `INITIATED`, RFQ
  `REQUESTED`, accept an offer.
- **taker** (assignee) — accept and ride: `ACCEPTED` / `REJECTED` / `QUOTED` / `COUNTERED`.

Triage (read a deposit → decide which move) lives in the kit's `CLAUDE.md` as the agent's
default behavior, not a third skill. The per-strategy **railway maps** sit beside the
skills as shared, static reference both consult.

## Strategies (railways)

- **Railway map** (steps, legal transitions, required fields) → static reference in the
  kit. How the agent knows an illegal move *before* hitting the API.
- **Railway position** (current step, instance id, target, providerRef) → Heroes-side,
  read by reference.

Scope: **HANDSHAKE first**, then solicited one-to-one **RFQ**. Standing-offer strategy
deferred (SCOPE.md).

## Intake → action

- **Channel vs content.** Intake is keyed by *who sent it* (channel) — always free to the
  human. Who is *named inside* (content) is resolved downstream into asset participants
  and service membership, never into intake routing.
- A dropped document typically *becomes* a document-type **asset**, binds to the service,
  and rides as the **attachment** on the event the agent posts; the raw file then moves to
  `intake/processed/`.

## Human-in-the-loop

The dashboard reveals that a decision is pending; input flows back via:
- **terminal** — quick yes/no/choose, answered where the agent runs;
- **intake** — anything content-bearing (a counter with terms, a reply email, a corrected
  document).

## First build — HANDSHAKE, one-to-one

The flagship loop, concretely (two peer Workspaces, A = maker, B = taker for *this* deal):

1. A human drops a booking from B into `A/counterparties/<B>/intake/`.
2. A's agent interprets it, creates a SHIPMENT journey + service, posts the `INITIATED`
   handshake to B, attaches the booking. Writes A's projection.
3. B's dashboard (polling) shows an incoming request — pending decision.
4. B accepts via terminal (or drops a confirmation in `B/counterparties/<A>/intake/`); B's
   agent posts `ACCEPTED` with a providerRef.
5. Both dashboards update; `show-service` confirms the strategy reached ACCEPTED.

The endpoints and payloads are already proven by the `heroes-demo-kit` CLI scripts; this
prototype wraps that knowledge into the agent + Workspace + dashboard model.

## Open / build-time decisions

- OUT projection schema (what files, what fields: state + activity log + pending markers).
- `self/` contents and how identity/config is provided.
- Autonomy policy: when the agent auto-executes vs always asks (within the HITL model above).
