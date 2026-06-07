# email-worker — substrate

Temporal.io workers for multi-tenant email processing — IMAP fetch, MSSQL metadata,
`.eml` archival to S3.

## Repo

| What | Where | Committed? |
|------|-------|------------|
| System code (canonical) | [Logic-Solutions-GmbH/logic-email-worker](https://github.com/Logic-Solutions-GmbH/logic-email-worker) | Yes — push to `logic-email-worker` |
| Local context clone | `source/` (this folder) | **No** — gitignored, pulled for reading only |
| My analysis work | `queries/`, `transforms/`, `prototypes/`, `notes/` (here in po-lab) | Yes — push to `po-lab` |

## Context

- **Branch:** `main`
- **Commit:** `1317df8` (2026-03-03)

## Pull / refresh context

```bash
# first time
git clone https://github.com/Logic-Solutions-GmbH/logic-email-worker.git source

# later
git -C source pull --ff-only
```

Or use the **pull-context** skill in `ai-engineering/LogicSolutionsGmbH`.

## Work here

No analysis migrated yet.
