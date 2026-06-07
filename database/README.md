# database — substrate

Canonical home for **database artifacts** (DDL, queries, schema snapshots, ERDs).

## Repos

| What | Where | Committed? |
|------|-------|------------|
| DB artifacts (canonical) | [Logic-Solutions-GmbH/databases](https://github.com/Logic-Solutions-GmbH/databases) | Yes — push to `databases` repo |
| Local context clone | `source/` (this folder) | **No** — gitignored, pulled for reading only |
| My analysis work | `queries/`, `transforms/`, `notes/` (here in po-lab) | Yes — push to `po-lab` |

## Pull / refresh context

```bash
# first time (already done locally)
git clone https://github.com/Logic-Solutions-GmbH/databases.git source

# later
git -C source pull --ff-only
```

Or use the **pull-context** skill in `ai-engineering/LogicSolutionsGmbH`.

## Workflow

1. **Explore** — draft SQL/Python here under `queries/` or `transforms/`.
2. **Promote** — when an artifact is stable/reusable, commit it to `databases` repo
   (edit `source/` and push from there, or clone `databases` separately for direct work).
3. **Refresh** — `git -C source pull` so po-lab context stays current.

## Migration note

`PO Workspace/Databases/` (Schryver_MVC, TMS_Inndigo, all_tenants, …) will migrate into
the `databases` repo over time — project by project, same pace as po-lab.
