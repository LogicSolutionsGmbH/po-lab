# schryver-mvc — substrate

The **Schryver TMS** application — an ASP.NET MVC (.NET) transport-management system
(`SchryverMVC` solution under `source/src/`). Pulled as read-only context to reason over
the real code while drafting PRDs / analyses here.

## Repos

| What | Where | Committed? |
|------|-------|------------|
| App code (canonical) | [Logic-Solutions-GmbH/logic-schryverMvc](https://github.com/Logic-Solutions-GmbH/logic-schryverMvc) | No — owned by its repo, never pushed from po-lab |
| Local context clone | `source/` (this folder) | **No** — gitignored, pulled for reading only |
| My analysis work | `queries/`, `transforms/`, `prototypes/`, `notes/` (here in po-lab) | Yes — push to `po-lab` |

> Note: the repo's **default branch is `Development`**; this substrate is pinned to
> **`master`** per the pull request.

## Pull / refresh context

```bash
# first time (done)
git clone --branch master https://github.com/Logic-Solutions-GmbH/logic-schryverMvc.git source

# later
git -C source pull --ff-only
```

Or use the **pull-context** skill in `ai-engineering/LogicSolutionsGmbH`.

## Context revision

- Branch: `master`
- Commit: `fbe1cb598` — *Merge pull request #766 from Logic-Solutions-GmbH/Development* (2026-06-05)

## Workflow

1. **Read** `source/src/SchryverMVC` to understand the system.
2. **Draft** analysis / PRD substrate under `notes/`, SQL under `queries/`, Python under `transforms/`.
3. **Refresh** — `git -C source pull --ff-only` to keep context current.
