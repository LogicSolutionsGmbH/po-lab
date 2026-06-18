# heroes — substrate

Context home for **Logic Heroes** (visibility / track-and-trace platform) analysis.

## Repos

| What | Where | Committed? |
|------|-------|------------|
| Heroes source (canonical) | [Logic-Solutions-GmbH/logic-heroes](https://github.com/Logic-Solutions-GmbH/logic-heroes) | No — never push from here |
| Local context clone | `source/` (this folder) | **No** — gitignored, pulled for reading only |
| My analysis work | `queries/`, `transforms/`, `prototypes/`, `notes/` | Yes — push to `po-lab` |

Context commit: `main` @ `fc98d87` (pulled 2026-06-18).

## Pull / refresh context

```bash
git -C source pull --ff-only   # refresh
```

Or use the **pull-context** skill.

## Work that lives here

- `notes/credential-store-encryption-research.md` — deep-research findings on the
  production-proven recipe for read-back, rotation-safe, multi-tenant credential
  encryption. Independent of any Heroes-specific design.
- `notes/credential-store-cross-examination.md` — contrasts that research **and** a
  colleague's Heroes credential-store design doc against each other and against the
  real `source/` code. Feeds the credential-storage design reconvene.

Origin: 2026-06-01 Heroes credential-storage design call (Carlos + Dima + Valeriy).
See KB `Projects/Logic Heroes.md` → "Per-tenant credential / secret storage".
