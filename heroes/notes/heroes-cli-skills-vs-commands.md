# Heroes CLI demo: skills vs commands, and the role split

Context: the `feature/heroes-cli-examples` branch of `logic-heroes` adds standalone
TypeScript example scripts (`examples/heroes-cli/`) that drive the API end to end —
create-shipment, initiate/accept/reject handshake, list-requests, show-service.
Concept: wrap these so a client can open a Claude session in the folder, drop a
payload, and drive the happy path in plain English.

## Decision 1 — skills, not slash commands

- **Commands are user-typed shortcuts.** `/create-shipment schryver ...` only fires
  when someone types it and knows the name + arg order — that's the CLI with a `/`.
- **Skills are model-invoked.** Claude reads the description, decides relevance to
  "create a shipment / send a service request", loads the body, and orchestrates the
  scripts. That matches the demo's value: the client *says it in plain English*.
- The happy path carries **state between steps** (`serviceId` from create → accept →
  verify). A command is a single prompt expansion; a skill body can encode the
  orchestration.
- Commands still fit for the **operator** (you): deterministic setup/reset wrappers
  like `/reset-demo`, where you don't want Claude improvising.

## Decision 2 — split by role (assigner vs taker)

Role is the real axis of variation, stronger than any per-script boundary:

| | assigner (maker) | taker (assignee) |
|---|---|---|
| intent | create shipment, request service | triage inbox, accept/reject |
| scripts | create-shipment, initiate-handshake | accept-strategy, reject-strategy |
| discovery | list-requests --direction outgoing | list-requests --direction incoming |
| key | MAKER_API_KEY | TAKER_API_KEY |
| permission | can initiate | only the target can accept/reject (API-enforced) |

Why split:
1. A real client occupies **one role** — ship only their half; a blended skill
   can't be handed to a single-role client cleanly.
2. Crisper descriptions → better model triggering (skills are picked by description).
3. Encodes the API's own permission boundary.

Structure: **2 skills + 1 shared reference** (not a third "skill" — a pure-reference
skill with no action is an anti-pattern). Shared file = auth/.env, payload-folder
convention, show-service, state diagram; both SKILL.md files link to it.
`list-requests` is role-flavored (outgoing vs incoming), so it lives in each skill.

The end-to-end demo still works: on one machine with both keys, load both skills and
Claude moves between them — full round trip, each half independently shippable.

Deciding question: *who holds which keys.* One tenant per client kit → ship one role
skill. Both keys on the demo box → load both.

## Built artifact

`heroes/prototypes/heroes-demo-kit/` — self-contained, ready to download: the example
scripts (copied from `examples/heroes-cli` @ branch `feature/heroes-cli-examples`),
plus `.claude/skills/{heroes-assigner,heroes-taker}` and
`.claude/references/handshake-flow.md`, a demo-quickstart `README.md`, the original
script docs as `API-SCRIPTS.md`, and a `.gitignore` protecting `.env`.
