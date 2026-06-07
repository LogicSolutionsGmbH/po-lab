# journeys — substrate

Next.js frontend for **Logic Journeys** (TMS workflows, tasks, supplier invoices, tracking).

## Repo

| What | Where | Committed? |
|------|-------|------------|
| System code (canonical) | [Logic-Solutions-GmbH/logic-journeys](https://github.com/Logic-Solutions-GmbH/logic-journeys) | Yes — push to `logic-journeys` |
| Local context clone | `source/` (this folder) | **No** — gitignored, pulled for reading only |
| My analysis work | `queries/`, `transforms/`, `prototypes/`, `notes/` (here in po-lab) | Yes — push to `po-lab` |

## Context

- **Branch:** `main`
- **Commit:** `25376b6` (2026-06-04)

## Pull / refresh context

```bash
# first time
git clone https://github.com/Logic-Solutions-GmbH/logic-journeys.git source

# later
git -C source pull --ff-only
```

Or use the **pull-context** skill in `ai-engineering/LogicSolutionsGmbH`.

## Work here

Migration pending from `PO Workspace/journeys/` (adoption charts, procurement offers,
supplier-invoices, tasks & emails, tracking SQL, …).
