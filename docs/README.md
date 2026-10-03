# Documentation (living)

> 👤 **Hosting, administering or operating QuizDock?** Read the
> [Documentation](https://quizdock.github.io/docs/). This folder is for **contributors**.

This folder holds the **development documentation**, kept in step **with the code** — as opposed to [`../specifications/`](../specifications/README.md), which freezes the reference design per version.

> Rule: **every iteration** is **tested** and **documented**. Any change of behaviour updates the documentation it concerns **in the same commit/PR** — here for contributors, on the site for hosts, administrators and operators.

## What belongs here

| Kind | Example |
|------|---------|
| **ADRs** (Architecture Decision Records) | `adr/0001-i18n-et-glossaire.md` — dated technical decisions and what justified them |
| **Developer guides** | local setup, code conventions, git/CI workflow |
| **Living API documentation** | notes alongside the generated OpenAPI, usage examples |
| **Feature notes** | how a shipped feature actually behaves, and where it departs from the spec |
| **Release process** | [`releasing.md`](releasing.md); the history is the root [`CHANGELOG.md`](../CHANGELOG.md) |

## specifications/ vs docs/

- **`specifications/`** = *what we decided to build* (the founding intent). It is not kept in step with the code, and may drift from it.
- **`docs/`** = *how it is actually built* (the current state, evolving). The source of truth for the implementation.

When the implementation departs from a spec, the gap is noted here when a contributor needs it; the spec stays as it was written.

## Structure

```
docs/
├── README.md
├── adr/                 # architecture decisions
├── dev/                 # developer notes: load testing, performance, audits
├── security/            # scanning, hardening, point-in-time audits
├── self-hosting/        # relay pages to the site's operator Documentation
└── releasing/           # image retention (a proposal)
```

## Feature notes

- [`quiz-bundle.md`](quiz-bundle.md) — the import / export format of a quiz (`quiz.json` + `media/`).
- [`scoring.md`](scoring.md) — the scales: points, speed, streak, per-type variants (closest, partial credit, lenient).
- [`live-session.md`](live-session.md) — the live session: substance/form snapshot, states, looking back, resuming after a restart, media on every device (experimental), the invitation address.
- [`dev/load-testing.md`](dev/load-testing.md) — load testing a live game: the benchmark, how many players one instance holds, the sizing it gives (published for operators in [sizing](https://quizdock.github.io/docs/operator/sizing/)).
- [`dev/performance-roadmap.md`](dev/performance-roadmap.md) — where the live engine spends its time (profiled), what was done, and the options to go further, in order.
- [`dev/audit-2026-09.md`](dev/audit-2026-09.md) — the September 2026 code audit (bugs, duplicates, CSS), the decisions taken, and what each lot fixed.
- [`tech-debt.md`](tech-debt.md) — known shortcuts, what they cost and what would replace them (OIDC tokens at rest in Redis, the CSP's loose points, an unread column, a dark theme nothing turns on).
- [`../apps/frontend/src/i18n/GLOSSARY.md`](../apps/frontend/src/i18n/GLOSSARY.md) — the interface vocabulary (6 languages) and the choices behind it.
