# Brand & hosting — QuizDock

> State as of 2026-06-24. The brand comes from the `live-quizz` → `QuizDock` rename (see
> [ADR 0003](adr/0003-rename-quizdock.md)). Positioning: **real-time live quizzes,
> open-source and self-hostable** ("dock" ⇒ container deployment).

## Identity

| Item | Value |
|---|---|
| Displayed brand | **QuizDock** |
| Slug / package / repo | `quiz-dock` |
| DB / Docker Hub namespace | `quizdock` |
| npm scope | `@quiz-dock/*` |
| Code repository | `github.com/quizdock/quiz-dock` |
| Licence | **MIT** |

The brand name is **white-label at runtime**: an instance can display any other name through
`APP_NAME` and the `branding/` folder, with no rebuild (see [ADR 0002](adr/0002-rename-live-quizz-et-white-label.md)).

## Availability of the surfaces (as of 2026-06-24)

| Surface | `quizdock` | `quiz-dock` | Status |
|---|---|---|---|
| npm (+ scope) | free | free | to reserve if we publish |
| Docker Hub (namespace) | free | free | to reserve with the first image |
| GitHub (user/org) | **free** | free | **to reserve** (see below) |
| `.io` domain | free | free | optional |
| `.app` domain | free | free | optional |
| `.fr` domain | free | free | optional |
| `.com` domain | **taken** | free | — |
| GitLab | inconclusive (anti-bot) | — | to check if needed |

## Hosting the site — GitHub Pages

> ✅ **Live: <https://quizdock.github.io>** — the `quizdock` org exists, with the repo
> [`quizdock/quizdock.github.io`](https://github.com/quizdock/quizdock.github.io) (a static landing
> page + the Pages workflow `upload-pages-artifact` → `deploy-pages`, source *GitHub Actions*).

The target was **`https://quizdock.github.io`**. That URL requires a **GitHub organisation (or
account) named literally `quizdock`**, owning a `quizdock.github.io` repository. With the current
account being `fchaussin`, the default path would have given `fchaussin.github.io`.

### Recommended path — the `quizdock` organisation

1. **Create the free org** `quizdock`: <https://github.com/account/organizations/new> (*Free* plan).
   ⚠️ Not automatable — GitHub has no API for creating an org; it is a browser action (~1 min).
   It also reserves the name against third parties.
2. Create the **`quizdock.github.io`** repository in the org → the site is served at `https://quizdock.github.io`.
3. (Optional) **Transfer the code** from `fchaussin/quiz-dock` to `quizdock/quiz-dock` to keep
   everything together. The local remote then needs updating (`git remote set-url`).
4. (Optional) **Custom domain** (`quizdock.io` / `.fr`): a `CNAME` file in the Pages repository
   plus the DNS record.

### Immediate fallback — project Pages (no new org)

Enable Pages on `fchaussin/quiz-dock` → `https://fchaussin.github.io/quiz-dock/`.
A less tidy URL, but available straight away and without an org.

## Still to do

- [x] **Reserve the GitHub org `quizdock`** (personal account, Free plan).
- [x] Scaffold the `quizdock.github.io` repository (landing page + Pages workflow) → site online.
- [x] Transfer the code repository `fchaussin/quiz-dock` → **`quizdock/quiz-dock`** (local remote and site links updated).
- [x] **MIT** licence added (`LICENSE` + the `license` field of the `package.json` files + a README section).
- [ ] (Optional) Reserve npm and Docker Hub before the first public release.
- [x] Custom domain: dropped — we stay on `quizdock.github.io`.
