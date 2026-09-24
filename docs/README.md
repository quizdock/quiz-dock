# Documentation (living)

> 👤 **Hosting or configuring QuizDock?** The **user / integrator** documentation
> (installation, configuration, branding, OIDC) lives in
> [`self-hosting/`](self-hosting/README.md). This folder is for **contributors**.

This folder holds the **development documentation**, kept in step **with the code** — as opposed to [`../specifications/`](../specifications/README.md), which freezes the reference design per version.

> Rule (see technique §18): **every iteration** is **tested** and **documented**. Any change of behaviour updates the documentation it concerns **in the same commit/PR**.

## What belongs here

| Kind | Example |
|------|---------|
| **ADRs** (Architecture Decision Records) | `adr/0001-i18n-et-glossaire.md` — dated technical decisions and what justified them |
| **Developer guides** | local setup, code conventions, git/CI workflow |
| **Living API documentation** | notes alongside the generated OpenAPI, usage examples |
| **Operations / runbook** | deployment, environment variables, backup and purge, incidents |
| **Feature notes** | how a shipped feature actually behaves, and where it departs from the spec |
| **CHANGELOG** | (at the root or here) the history of the `0.x` releases |

## specifications/ vs docs/

- **`specifications/`** = *what we decided to build* (the intent, frozen and versioned). The source of truth for the design.
- **`docs/`** = *how it is actually built and operated* (the current state, evolving). The source of truth for the implementation.

When the implementation departs from a spec on purpose, the spec is updated **and** the gap is noted here.

## Suggested structure (create as needed)

```
docs/
├── README.md
├── adr/                 # architecture decisions
├── dev/                 # developer guides (setup, conventions)
├── api/                 # additions to the OpenAPI / WS contract
└── ops/                 # runbook, deployment, operations
```

## Feature notes

- [`quiz-bundle.md`](quiz-bundle.md) — the import / export format of a quiz (`quiz.json` + `media/`).
- [`scoring.md`](scoring.md) — the scales: points, speed, streak, per-type variants (closest, partial credit, lenient).
- [`live-session.md`](live-session.md) — the live session: substance/form snapshot, states, looking back, resuming after a restart, media on every device (experimental), the invitation address.
- [`tech-debt.md`](tech-debt.md) — known shortcuts, what they cost and what would replace them (OIDC tokens in the browser, the client address behind a proxy…).
- [`../apps/frontend/src/i18n/GLOSSARY.md`](../apps/frontend/src/i18n/GLOSSARY.md) — the interface vocabulary (5 languages) and the choices behind it.
