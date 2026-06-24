<p align="center">
  <img src="https://quizdock.github.io/logo.svg" width="220" alt="QuizDock" />
</p>

<h1 align="center">QuizDock</h1>

<p align="center">
  <strong>Open-source, self-hosted live quiz platform.</strong><br />
  Real-time multiplayer · projector-ready · your data stays on your servers.
</p>

<p align="center">
  <a href="https://github.com/quizdock/quiz-dock/releases"><img alt="Release" src="https://img.shields.io/github/v/release/quizdock/quiz-dock?logo=github&color=6f42c1" /></a>
  <a href="https://github.com/quizdock/quiz-dock/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/quizdock/quiz-dock?color=blue" /></a>
  <a href="https://github.com/quizdock/quiz-dock/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/quizdock/quiz-dock/ci.yml?branch=main&logo=github&label=CI" /></a>
  <a href="https://github.com/quizdock/quiz-dock/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/quizdock/quiz-dock?logo=github" /></a>
  <a href="https://github.com/quizdock/quiz-dock/issues"><img alt="Issues" src="https://img.shields.io/github/issues/quizdock/quiz-dock?logo=github" /></a>
  <img alt="Last commit" src="https://img.shields.io/github/last-commit/quizdock/quiz-dock?logo=git&logoColor=white&color=informational" />
</p>

<p align="center">
  <a href="https://hub.docker.com/r/fchaussin/quizdock"><img alt="Docker pulls" src="https://img.shields.io/docker/pulls/fchaussin/quizdock?logo=docker&logoColor=white&label=pulls" /></a>
  <a href="https://hub.docker.com/r/fchaussin/quizdock/tags"><img alt="Image version" src="https://img.shields.io/docker/v/fchaussin/quizdock?sort=semver&logo=docker&logoColor=white&label=image" /></a>
  <a href="https://hub.docker.com/r/fchaussin/quizdock/tags"><img alt="Image size" src="https://img.shields.io/docker/image-size/fchaussin/quizdock/latest?logo=docker&logoColor=white&label=size" /></a>
  <img alt="Architectures" src="https://img.shields.io/badge/arch-amd64%20·%20arm64-2496ED?logo=docker&logoColor=white" />
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" />
  <img alt="NestJS" src="https://img.shields.io/badge/NestJS-E0234E?logo=nestjs&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white" />
  <img alt="Socket.IO" src="https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio&logoColor=white" />
  <img alt="Prisma" src="https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white" />
  <img alt="Redis" src="https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white" />
</p>

<p align="center">
  <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-✓-success" />
  <img alt="No tracking" src="https://img.shields.io/badge/tracking-none-success" />
  <img alt="i18n" src="https://img.shields.io/badge/i18n-en%20·%20fr%20·%20es%20·%20zh-6f42c1" />
  <a href="https://quizdock.github.io"><img alt="Website" src="https://img.shields.io/badge/website-quizdock.github.io-22d3ee" /></a>
  <img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen" />
</p>

---

QuizDock is a Kahoot-style live quiz you run yourself. A host presents a quiz, players
join from any device with a **PIN or QR code** (no account), and answers — weighted by
speed and correctness — feed a live leaderboard projected on the big screen. Everything
runs on **your** infrastructure as a single Docker image; the questions, the answers and
the results never leave your servers.

🌐 **Website:** https://quizdock.github.io

## ✨ Features

- ⚡ **Real-time multiplayer** — Socket.IO engine with authoritative server timing; players join by 6-digit PIN or QR code.
- 🦄 **Player avatars** — every player gets a unique, generated [Multiavatar](https://multiavatar.com) avatar — no upload, no account.
- 🖥️ **Projector-ready** — bright, high-contrast light screens built for the big screen, with separate projection and control windows.
- 🧩 **Quiz builder** — seven question types (single/multi choice, true-false, text, numeric, reorder, poll) with image & audio media.
- 🏆 **Live scoring & podium** — time-weighted points with streak bonuses, leaderboard between questions, final podium; manual or auto pacing.
- 💾 **Answer capture** — optionally record every player's individual answers for audit, certification or individual follow-up.
- 🔎 **History & exploration** — browse archived sessions: per-question success rates, average times, and per-player answer sheets.
- 📤 **CSV export** — export overall results and per-player answer sheets.
- 🌍 **Multilingual** — interface in English, French, Spanish and Simplified Chinese (one language per instance).
- 🏠 **Self-hosted & private** — runs on your own infra with Docker; no SaaS, no tracking, no ads; players need no account, hosts can plug in OIDC.
- 🎨 **White-label** — rebrand name, logo and CSS via env + a mounted folder, no rebuild.

## 🚀 Quick start (self-host)

QuizDock ships as **one image** — [`fchaussin/quizdock`](https://hub.docker.com/r/fchaussin/quizdock)
on Docker Hub (multi-arch `amd64` / `arm64`). NestJS serves the API, the WebSocket and the SPA;
PostgreSQL and Redis run alongside, and a one-shot `migrate` service applies migrations.

### Option A — Docker Hub image (recommended)

Pull the published image and run the stack — no build, no source checkout:

```bash
docker pull fchaussin/quizdock:latest
curl -O https://raw.githubusercontent.com/quizdock/quiz-dock/main/docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d
# then open the app
open http://localhost:18080
```

Pin a version with `QUIZDOCK_TAG=0.3.0 docker compose -f docker-compose.prod.yml up -d`.

### Option B — build from source

```bash
git clone https://github.com/quizdock/quiz-dock.git
cd quiz-dock
docker compose -f docker-compose.prod.yml up -d --build
open http://localhost:18080
```

## ⚙️ Configuration

Copy `.env.example` to `.env` and adjust. Common settings:

| Variable | Default | Purpose |
|---|---|---|
| `APP_NAME` | `QuizDock` | App name shown in the UI (white-label) |
| `APP_LANG` | `en` | Instance language: `en` · `fr` · `es` · `zh` |
| `AUTH_MODE` | `none` | `none` (local/demo) or `oidc` (bring your own IdP) |
| `HTTP_PORT` | `18080` | Host port for the app |

Rebrand without rebuilding: set `APP_NAME` / `APP_LANG` and drop a `logo.svg` + `override.css`
into the mounted `branding/` folder. The runtime is hardened (non-root, read-only root FS,
all Linux capabilities dropped, `no-new-privileges`).

## 🧱 Tech stack

**Backend** NestJS + Socket.IO · Prisma 7 / PostgreSQL · Redis (live state) ·
**Frontend** React + Vite + shadcn/ui + TanStack · i18next ·
**Packaging** single distroless image · Docker Compose. Front/back are kept in sync via an
auto-generated OpenAPI client (Orval) and a shared TypeScript WebSocket contract.

## 🛠️ Development

Dev runs backend (NestJS, hot-reload) and frontend (Vite) as separate services:

```bash
pnpm install
docker compose up -d
# Front: http://localhost:15173   ·   API: http://localhost:13000   ·   API docs: http://localhost:13000/api/docs
```

Design references live in [`specifications/`](./specifications/README.md); ongoing notes and
decisions in [`docs/`](./docs/README.md) (see the [ADRs](./docs/adr)).

## 📄 License

[MIT](https://github.com/quizdock/quiz-dock/blob/main/LICENSE) — free to use, modify and
redistribute, including for internal self-hosting, provided the copyright notice is kept.
