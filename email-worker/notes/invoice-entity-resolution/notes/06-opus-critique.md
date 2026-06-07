# Opus critique — `resolve-entity` PRD v1.0

**Date:** 2026-06-07
**Reviewer:** Claude Opus 4.8
**Reviewing:** `PRD-resolve-entity.md` v1.0 + `05-implementation-research.md`
**Status:** critique for review (Codex invited as second critic before PRD finalize)

> **Verdict in one line:** strong product spec, questionable technical centerpiece. The data
> model, never-guess invariant, provision gate, AP-only, and reviving Participantes are right.
> The **"agentic loop" as the resolver is the wrong tool**, and — more decisively for our
> roadmap — **placing resolution inside the worker is an architectural mistake** because the
> endpoint will be consumed in many places.

---

## 1. The placement problem (the decisive one)

This is the most important issue and it overrides the "in-line" framing in the PRD.

### The PRD conflates two different decisions

The PRD's G2 / FR-1 says: *"Call `resolve-entity` in-line from existing extraction code (no new
workflow activity)."* That sentence bundles **two unrelated decisions**:

1. **Workflow topology** — don't add a new Temporal *activity* that downstream workflows must
   wait on. ✅ Correct, keep it.
2. **Code location** — *where the resolution logic lives*. ❌ The PRD implicitly puts it in the
   worker. This is the mistake.

"In-line" should mean **the worker makes an in-line call to a shared resolution service**, not
that the worker **contains** the resolution logic.

### Why worker-local resolution is wrong

Resolution is **not** an email/extraction concern — it's a **directorio concern** that many
surfaces need:

| Consumer (today or near-term) | Needs resolve-entity |
|-------------------------------|----------------------|
| email-worker AP extraction | resolve vendor at extraction |
| journeys **Claim** tab | already calls `resolveDirectoryEntityForDb` (the kernel) |
| journeys **provision** lookup/booking | currently a separate `rows[0]`-guessing waterfall |
| future: AR / client resolution, manual invoice entry, directorio dedupe tooling, any importer | same matcher |

The resolution kernel **already exists once** in journeys
(`resolve-directory.helper.ts`) and is **already duplicated in spirit** by the provision
waterfall (`provision.lookup-directory.data.ts`). Putting a third copy in the worker would make
**three** divergent resolvers. That is the duplication you're worried about — and it's already
starting.

### Resolution is a stateful service, not a copyable library

It queries `TCSch_Directorio*` per tenant, holds an alias cache, expands tenant groups, and (in
the better design) reads/writes a **learned-alias table**. That state has to have **one owner**.
A shared *library* copied into the worker still fragments the cache and the learned aliases. So:

> **One canonical resolution service, one owner, exposed as a versioned endpoint. Everyone
> else — worker included — calls it. Nobody re-implements it.**

### Where should it live?

Three options, ranked:

| Option | Home | Pros | Cons |
|--------|------|------|------|
| **A (preferred)** | **core-node** (`logic-core-node`, NestJS backend) | The natural shared backend; both journeys and worker are clients; clean ownership; one DB context for alias/learned state | core-node has nothing today; port the kernel from journeys |
| B | Keep in **journeys**, expose `POST /resolve-entity`, worker calls over HTTP | Kernel already there; least migration | worker now depends on the web app's uptime/deploy; odd dependency direction |
| C | Shared **npm workspace package** imported by both | Type-safe, no network hop | Resolution is DB-bound + stateful → a lib still needs a service around it; fragments cache/learned-alias unless it also centralizes a store |

My recommendation: **A** — move the kernel into core-node as `POST /directory/resolve-entity`,
make journeys (Claim, provision) and the worker all clients. If core-node adoption is too slow,
**B** as an interim, but commit to A as the target so we don't entrench the journeys-owns-it
coupling.

The worker change then becomes trivial and duplication-free: after `storeExtractedInvoice`, make
an **in-line HTTP call** to the shared endpoint, write Participantes from the response. No matcher
code in the worker at all.

---

## 2. The "agentic" centerpiece — wrong tool for this problem

### 2.1 The agent attacks the wrong bottleneck

Resolution quality is gated by **input signal availability**, not matching cleverness. Today
`extractInvoiceCharges` extracts **only tax_id + financials** — no vendor name, city, address,
or EORI. The agent's tools ("retry with more params", "narrow by location") retry with **signals
that were never extracted**. You can't narrow by a city you don't have.

> Highest-leverage change: extract a **rich signal bundle** (all candidate issuer names, every
> tax_id/EORI, city, address, country) in the **single extraction pass you already pay for**,
> then resolve once.

### 2.2 The deterministic engine already exists and is good

`resolve-directory.helper.ts` does weighted multi-signal scoring, legal-suffix normalization
(handles MSC "SA" vs "S A"), fuzzy + double-metaphone, an alias cache, tenant-group expansion,
and an explicit clear-winner gap rule. It returns `matched | ambiguous | not_found` + candidates
+ confidence. The agent's proposed tools mostly **duplicate operations the engine already does**
(`rankAddressesBySignals`, alias cache).

### 2.3 Per-scenario: the agent adds ~nothing

| Scenario | What actually resolves it | Agent helps? |
|----------|---------------------------|--------------|
| 1 — misleading PDF (wrong issuer top-right) | Better **extraction** (emit all issuer candidates) | No — re-querying the directory can't fix bad extraction; this is mislabeled as a resolution problem |
| 2 — duplicate entities (MSC SA/S A; two "Logic Solutions") | Deterministic ambiguity → block | No — genuinely unresolvable; looping burns tokens before blocking anyway |
| 3a/3b — not found / no tenant address | Deterministic | No |
| 1b — address ambiguity | Deterministic narrow by city/country | No — engine already re-ranks addresses |

In every branch the agent either can't help or duplicates the deterministic path.

### 2.4 The deepest objection: stochastic gatekeeper vs "never guess"

The #1 requirement is **never guess** on a money-moving decision. An LLM agent is, by
construction, a **probabilistic guesser**. Using a stochastic component as the gatekeeper of a
never-guess invariant is backwards. You want **determinism, reproducibility, and an audit trail**
("why did we pick entity 4471"). The PRD's own acceptance tests (TC-1…TC-10) are deterministic
assertions — which is itself evidence the engine should be deterministic. An agent won't reliably
reproduce `resolution_status` run-to-run.

### 2.5 Cost framing is inconsistent

The PRD excludes PDF re-fetch on cost grounds, then adds **up to 3 LLM calls per AP invoice** —
including the large majority that are clean exact matches, where the agent is pure overhead and
added latency on the hot path.

---

## 3. Recommended design (keeps ~80% of the PRD)

1. **One canonical resolution service** (core-node), exposed as a versioned endpoint. All
   consumers call it; nobody re-implements. (See §1.)
2. **Rich extraction up front** — one pass produces a full signal bundle. Highest leverage.
3. **Deterministic resolver runs once** (the existing kernel) → `matched | ambiguous | not_found`
   + candidates + confidence.
4. **Persistent learned-alias table**, fed by **human confirmations**
   (`entity_name+tenant → confirmed entity_id`). This is the real compounding win and it's
   deterministic: every manual resolution auto-resolves the next identical invoice.
   `check_previous_resolutions` should be **this table**, not an agent tool.
5. **Confidence thresholds enforce never-guess** — below threshold or multi-entity → block →
   surface candidates to the human (the gate). Deterministic, auditable, testable.
6. **Reserve the LLM for extraction**, where judgment actually lives (which of several names on a
   messy PDF is the issuer). Feed structured candidates to the deterministic resolver. Optionally
   use an LLM **offline** to *suggest* alias links for human approval — never as the live
   gatekeeper.

This still delivers the PRD's product goals: AP-only, in-line (now: in-line call to shared
endpoint), Participantes as final store, `resolution_status`, the provision gate, and never-guess
— but with determinism, reuse, and no worker-local duplication.

---

## 4. Issues to fix regardless of approach

- **Kill the existing guess paths.** email-worker classification does `LIKE '%issuer%'` →
  first-hit (`store.attachment.classification.ts`); provision waterfall returns `rows[0]`
  (`provision.lookup-directory.data.ts`). Both silently violate never-guess; the PRD doesn't call
  for retiring them.
- **`resolution_status` needs a real column** on `TESch_FacturaExtraidaParticipantes` (+ codegen
  in every consumer). PRD treats it lightly.
- **Contract drift:** PRD `exact_match` vs engine `matched`; PRD `recommendations[]` vs engine
  `hints[]` (input-completeness only); PRD top-level `entity_address_id` vs engine
  `entity.addresses[]` with no single pick; `eri` (PRD typo) vs `eori` (code). Lock one contract
  before build.
- **`address_not_for_tenant`** is a derived state, not an endpoint status — the engine currently
  returns `matched` with empty `addresses[]`. Needs explicit handling.

---

## 5. Questions for Codex (second critic)

1. Is core-node the right home for a shared resolution service, or does directorio ownership
   argue for journeys? Where does the learned-alias store live?
2. Worker → service call: HTTP endpoint vs shared package + thin client? Trade network coupling
   vs deploy/version coupling.
3. Is there a real case where an LLM in the **resolution** step (not extraction) adds resolution
   power the deterministic engine can't — e.g. world-knowledge aliases beyond fuzzy/suffix norm?
4. If we keep a bounded agent, should it be **extraction-time** (signal harvesting) only, with
   resolution strictly deterministic?
5. Versioning/SLA: many consumers on one endpoint — contract version, latency budget on the
   extraction hot path, failure mode when the service is down (block vs degrade)?

---

## References

- PRD: `../PRD-resolve-entity.md`
- Gap research: `05-implementation-research.md`
- Resolve kernel: `journeys/source/.../directory/resolve-directory.helper.ts`
- Provision waterfall (guess path): `journeys/source/.../provision/provision.lookup-directory.data.ts`
- Classification guess path: `email-worker/source/.../attachment-classification-activities/store.attachment.classification.ts`
