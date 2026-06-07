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
- [x] System substrates scaffolded (`pull-context` — full layout):
  - `journeys/` — README + work dirs + `source/` @ `main` `25376b6`
  - `email-worker/` — README + work dirs + `source/` @ `main` `1317df8`
  - `core-node/` — README + work dirs + `source/` @ `main` `5d91940`
  - Root `README.md` substrate index updated
- [x] `pull-context` skill updated: scaffold on first pull, refresh-only on repeat
- [x] Commit substrate scaffolds to `po-lab` origin (`06ca283`)
- [ ] First system substrate migration (e.g. journeys) — PO Workspace artifacts into po-lab
