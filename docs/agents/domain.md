# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

**Layout: single-context.** This repo was confirmed at setup time as **single-context** — one repo shares a single root-level glossary, with architecture decisions recorded in `docs/adr/`. There is no `GLOSSARY-MAP.md` and no per-subproject glossary.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (this repo):

```
/
├── GLOSSARY.md
├── docs/
│   ├── adr/
│   │   ├── 0001-<decision>.md
│   │   └── 0002-<decision>.md
│   └── agents/
│       ├── issue-tracker.md
│       ├── triage-labels.md
│       └── domain.md
└── ...
```

Because this is single-context, do **not** introduce `GLOSSARY-MAP.md` or per-subproject `GLOSSARY.md` files.

## Naming note

The setup UI refers to the root domain file as `CONTEXT.md`. The engineering skills in this suite — `/domain-modeling` and the `GLOSSARY-FORMAT.md` / `ADR-FORMAT.md` references — use **`GLOSSARY.md`**. This repo follows the skill suite convention: **`GLOSSARY.md`** at the repo root. Treat `GLOSSARY.md` as the file to read and create.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
