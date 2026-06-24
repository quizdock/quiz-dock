<p align="center">
  <img src="https://quizdock.github.io/logo.svg" width="220" alt="QuizDock" />
</p>

<h1 align="center">QuizDock</h1>

<p align="center">
  <strong>Open-source, self-hosted live quiz platform.</strong><br />
  Real-time multiplayer · projector-ready · your data stays on your servers.
</p>

<p align="center">
  <a href="https://github.com/quizdock/quiz-dock/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/self--hosted-Docker-2496ED.svg" alt="Self-hosted" />
  <img src="https://img.shields.io/badge/i18n-en%20·%20fr%20·%20es%20·%20zh-6f42c1.svg" alt="Languages" />
  <a href="https://quizdock.github.io"><img src="https://img.shields.io/badge/site-quizdock.github.io-22d3ee.svg" alt="Website" /></a>
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

QuizDock ships as **one image** (NestJS serves the API, the WebSocket and the SPA);
PostgreSQL and Redis run alongside, and a one-shot `migrate` service applies migrations.

```bash
git clone https://github.com/quizdock/quiz-dock.git
cd quiz-dock
docker compose -f docker-compose.prod.yml up -d --build
# then open the app
open http://localhost:18080
```

> A published image (`docker pull …`) is on the way; for now the prod compose builds it locally.

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
