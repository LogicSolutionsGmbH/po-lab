# scratchpad — po-lab

## Scope

Personal analysis hub. `PO Workspace/` migrates here, project by project (slow).

## Model (approved 2026-06-07)

- One folder per **substrate** (a system repo, or the DB-artifacts repo).
- `source/` = gitignored clone (context only); my work (`queries/`, `transforms/`,
  `prototypes/`, `notes/`) is committed.
- Full design: `ai-engineering/LogicSolutionsGmbH/docs/superpowers/specs/2026-06-07-po-lab-architecture-design.md`

## Done

- [x] Repo created (`LogicSolutionsGmbH/po-lab`) + cloned to `CEO/po-lab/`
- [x] Root `README.md`, `.gitignore`, scratchpad scaffolded

## Open

- [x] First push of po-lab to origin (main)
- [x] Database substrate wired: `Logic-Solutions-GmbH/databases` → `database/source/` (gitignored)
- [x] Pushed database substrate docs to origin (`6413e26`)
- [ ] Migrate `PO Workspace/Databases/` artifacts into `databases` repo (project by project)
- [ ] First system substrate migration (e.g. journeys)
