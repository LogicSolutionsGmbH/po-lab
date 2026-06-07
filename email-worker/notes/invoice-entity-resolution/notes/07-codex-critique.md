# Codex critique — `resolve-entity` PRD v1.0

**Date:** 2026-06-07  
**Reviewer:** Codex  
**Reviewing:** `PRD-resolve-entity.md` + `05-implementation-research.md` + `06-opus-critique.md`

## Verdict

The PRD is directionally strong, but it mixes a good **business contract** with a risky
**implementation shape**.

- Keep: never-guess invariant, AP-only scope, provision gate, Participantes as final store.
- Change: make `resolve-entity` a **shared platform endpoint**, not worker-local logic.
- Refine: treat LLM as an extraction aid, not the primary decision engine for resolution.

## What is strong

1. **Risk policy is correct.** Blocking on ambiguity is the right failure mode for financial
   posting.
2. **Data model intent is correct.** `FacturaExtraidaParticipantes` as the final, normalized
   resolution layer is exactly the right place to anchor gating and manual overrides.
3. **Operational constraint is correct.** Avoiding a new Temporal activity is reasonable.

## Core critique

### 1) In-line call is good; in-line ownership is not

The PRD wording makes it easy to implement resolution *inside* email-worker. That will create a
new copy of resolver logic and diverge from journeys, where a strong resolver already exists.

Recommended interpretation:

- **In-line call** from extraction workflow: yes.
- **Shared resolver ownership** in one backend service: mandatory.

This directly addresses your concern: the endpoint is reused in many places, so worker-local
implementation is the wrong ownership boundary.

### 2) Current ecosystem already has resolver drift

From current source:

- `journeys` has `resolve-directory.helper.ts` (best resolver path).
- `journeys` provision lookup has a separate waterfall that can fall back to `rows[0]`.
- `email-worker` classification still has exact + `LIKE` first-hit behavior.

This is already three resolution philosophies. Adding a fourth in worker code will increase
inconsistency and make root-cause analysis harder.

### 3) Agentic loop should be bounded and secondary

I agree with Opus on this point: a stochastic loop is a poor primary gatekeeper for a
never-guess rule. The deterministic matcher should own final status derivation.

Practical compromise:

- deterministic core computes status + candidates;
- optional bounded LLM assistance can enrich missing signals (issuer alias normalization, etc.);
- final decision remains deterministic and auditable.

## Recommended architecture (codex)

## A. Canonical resolver service

Create a single endpoint (`POST /resolve-entity`) in the shared backend layer (target: core-node;
interim: journeys if needed), with versioned contract.

All callers use it:

- email-worker extraction (in-line HTTP call)
- journeys claim flow
- journeys provision flow
- future AR/import/manual tools

## B. Strict decision contract

Unify contract drift now:

- one status enum (`matched|ambiguous|not_found` or PRD naming, but one only),
- explicit `entity_id`, `entity_address_id`, and `resolution_status`,
- explicit reason/candidates payload shape.

## C. Persistence and learning

- Persist `resolution_status` in Participantes.
- Add a confirmed-resolution memory table (human-confirmed aliases) consumed by the resolver.
- Remove guessy fallbacks (`LIKE` first-hit, `rows[0]` supplier picks) once resolver is adopted.

## D. Observability

Add mandatory logs/metrics per call:

- input signal completeness,
- resolver status,
- ambiguity type (entity vs address),
- manual override count,
- median/95p latency.

Without these, tuning the threshold and proving quality improvements will be guesswork.

## PRD change requests before finalization

1. Reword FR-1 to separate **workflow shape** from **service ownership**.
2. Add a dedicated section: **\"Resolver ownership and reuse\"** (single endpoint, multi-consumer).
3. Add migration steps to retire current fallback paths in journeys/email-worker.
4. Lock final contract naming (status + recommendations/hints + address semantics).
5. Make deterministic resolver authoritative for final gate status.

## Final answer to your big question

No, the best solution is **not** to locate entity-resolution logic inside the worker.
The best solution is a **single shared resolver endpoint** called in-line by the worker and reused
everywhere else. That gives zero duplication, consistent outcomes, and one place to evolve rules.

