# po-lab — personal analysis hub

- **Owner:** LogicSolutionsGmbH
- **Remote:** https://github.com/LogicSolutionsGmbH/po-lab

A searchable library of my analysis work. `PO Workspace/` is migrating here, **project by
project** (slowly, on purpose).

## Model

One folder per **substrate** — a source of context I reason over:

- a **system** = an existing GitHub repo (`journeys`, `heroes`, `logic-schryverMvc`, ...)
- the **database** = a dedicated DB-artifacts repo

Each substrate folder:

- `source/` — clone of that repo, **gitignored**: pulled for context, never committed here
- **my work** (committed) — `queries/`, `transforms/`, `prototypes/`, `notes/`

po-lab version-controls only **my work**. The code stays owned by its real repo.

## Layout

```
po-lab/
├── <substrate>/
│   ├── README.md     # what it is, repo URL, what work lives here
│   ├── source/       # gitignored clone (context only)
│   ├── queries/      # SQL
│   ├── transforms/   # Python
│   ├── prototypes/   # graduated reusable work
│   └── notes/        # findings, context
└── README.md         # this index
```

## Pulling context

Use the **pull-context** skill (in `ai-engineering/LogicSolutionsGmbH`) to clone or
refresh any substrate's `source/`.

## Substrate index

| Substrate | Repo | Status |
|-----------|------|--------|
| `database` | [Logic-Solutions-GmbH/databases](https://github.com/Logic-Solutions-GmbH/databases) | `source/` pulled (empty repo — ready for artifacts) |
| `journeys` | [Logic-Solutions-GmbH/logic-journeys](https://github.com/Logic-Solutions-GmbH/logic-journeys) | scaffolded; `source/` @ `main` `25376b6` |
| `email-worker` | [Logic-Solutions-GmbH/logic-email-worker](https://github.com/Logic-Solutions-GmbH/logic-email-worker) | scaffolded; `source/` @ `main` `1317df8` |
| `core-node` | [Logic-Solutions-GmbH/logic-core-node](https://github.com/Logic-Solutions-GmbH/logic-core-node) | scaffolded; `source/` @ `main` `5d91940` |
| `schryver-mvc` | [Logic-Solutions-GmbH/logic-schryverMvc](https://github.com/Logic-Solutions-GmbH/logic-schryverMvc) | scaffolded; `source/` @ `master` `fbe1cb598` |

Full architecture: `ai-engineering/LogicSolutionsGmbH/docs/superpowers/specs/2026-06-07-po-lab-architecture-design.md`
