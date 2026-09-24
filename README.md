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
  <a href="https://hub.docker.com/r/fchaussin/quizdock"><img alt="Docker pulls" src="https://img.shields.io/docker/pulls/fchaussin/quizdock?logo=docker&logoColor=white&label=pulls" /></a>
  <a href="https://hub.docker.com/r/fchaussin/quizdock/tags"><img alt="Image size" src="https://img.shields.io/docker/image-size/fchaussin/quizdock/latest?logo=docker&logoColor=white&label=size" /></a>
</p>

<p align="center">
  <a href="https://quizdock.github.io">Website</a> ·
  <a href="https://quizdock-standalone.onrender.com">Live demo</a> ·
  <a href="https://github.com/quizdock/quiz-dock/tree/main/docs/self-hosting">Self-hosting guide</a> ·
  <a href="https://github.com/quizdock/quiz-dock/releases">Releases</a>
</p>

---

QuizDock is a Kahoot-style live quiz you run yourself. A host presents a quiz, players
join from any device with a **PIN or QR code** (no account), and answers — weighted by
speed and correctness — feed a live leaderboard projected on the big screen. Everything
runs on **your** infrastructure as a single Docker image; the questions, the answers and
the results never leave your servers.

<p align="center">
  <img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/demo.gif" width="800" alt="A session on the big screen: players join with the PIN, a question with its timer, the reveal with the leaderboard, the podium" />
</p>

> [!NOTE]
> **New in 0.7 — 🎧 video & sound in questions** *(experimental)*. MP4 videos and MP3
> sounds, loudness-matched, with a waveform; played on the projection **and** on the
> devices of remote participants, started on the same instant everywhere; *listen first*
> questions open the answers once the media has played. Tested in Chromium browsers, not
> yet on iPhone — see the
> [audio & video guide](https://github.com/quizdock/quiz-dock/blob/main/docs/self-hosting/audio-video.md).

## 🎮 Try it online

**https://quizdock-standalone.onrender.com** — a public instance in demo mode: enter the
demo, take a copy of the France or Taiwan template and present it; open the join link on
your phone to play.

- It sleeps when idle: the **first load can take about a minute**.
- Shared with strangers: **every visitor uses the same host account** (`demo_user`), so
  you may see — or step on — someone else's quizzes and sessions. **Everything is wiped
  every hour**, media uploads are off. Don't put anything you care about in it.

## ✨ Main features

- ⚡ **Live quiz, in real time** — players join by 6-digit PIN or QR code from any
  device, no account; a Socket.IO engine with authoritative server timing keeps everyone
  in step; each player gets a generated [Multiavatar](https://multiavatar.com) avatar.
- 🖥️ **Made for the big screen** — bright, high-contrast projection screens, with
  separate projection and control windows; manual or automatic pacing.
- 🧩 **A real quiz builder** — seven question types (single/multi choice, true-false,
  text, numeric, reorder, poll), images with alternative text, Markdown everywhere, content
  slides between questions, backgrounds, answer explanations at the reveal.
- 🎧 **Video & sound — _experimental_** — MP4 videos and MP3 sounds in questions,
  loudness-matched, drawn as a waveform with a playhead; played on the projection and on
  the devices of **remote participants** (who hears what is set per quiz, per question and
  per session), started on the same instant everywhere, fetched ahead from the lobby, and
  the room waits a moment for a device still loading. *Listen first* questions open the
  answers only once the media has played. Tested in Chromium browsers, not yet on iPhone:
  [audio & video guide](https://github.com/quizdock/quiz-dock/blob/main/docs/self-hosting/audio-video.md).
- 🏆 **Scoring that rewards speed** — time-weighted points, streak bonuses, leaderboard
  between questions, final podium; per-question rules (*closest answer wins*, partial
  credit, typo-tolerant text, double or fixed points).
- 🏠 **Self-hosted and private** — one Docker image (`amd64` / `arm64`), no SaaS, no
  tracking, no ads; interface in English, French, Spanish, Simplified and Traditional
  Chinese; rebrand name, logo and CSS without a rebuild.

## 🔑 Two ways to run it

Same image, one switch: `AUTH_MODE` decides who can host.

|  | **Local mode** — `AUTH_MODE=none` (default) | **OIDC mode** — `AUTH_MODE=oidc` |
|---|---|---|
| Made for | a classroom, a meeting room, a trusted network | an organisation with an identity provider |
| Setup | none — start the container and play | point the app at your OpenID Connect provider (Keycloak, Authentik, Entra ID, Google…) |
| Who hosts | one **host seat**: a host signs in with just a name and takes it; released when done | as many hosts as you like, each signing in through your IdP with their own quizzes |
| Host rights | whoever holds the seat | the `host` role, granted from the IdP |
| Sample quizzes | included | — |

Players never sign in, in either mode. Details: [authentication](https://github.com/quizdock/quiz-dock/blob/main/docs/self-hosting/auth.md).

## 🚀 Quick start (self-host)

QuizDock ships as **one image** — [`fchaussin/quizdock`](https://hub.docker.com/r/fchaussin/quizdock)
on Docker Hub. NestJS serves the API, the WebSocket and the SPA; PostgreSQL and Redis run
alongside, and a one-shot `migrate` service applies migrations.

### One container — first try, Docker Desktop

App **and** database in a single image, nothing else to install:

```bash
docker run -p 18080:3000 -v quizdock:/data fchaussin/quizdock:standalone
# open http://localhost:18080
```

Data persists in the `quizdock` volume. A deployment shortcut, not a different product:
same `AUTH_MODE` switch as below. For production, prefer a dedicated database.

### The `quizdock` script — recommended

Guided setup, then start, backup, upgrade and admin commands; Docker only:

```bash
curl -fsSLO https://raw.githubusercontent.com/quizdock/quiz-dock/main/quizdock && chmod +x quizdock
./quizdock init      # name, language, port, auth mode → .env + docker-compose.prod.yml
./quizdock up        # open http://localhost:18080
./quizdock doctor    # config & connectivity check; later: backup, upgrade <tag>, seat:release…
```

Every command: [`docs/self-hosting/cli.md`](https://github.com/quizdock/quiz-dock/blob/main/docs/self-hosting/cli.md).

### Docker Compose by hand

```bash
curl -O https://raw.githubusercontent.com/quizdock/quiz-dock/main/docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d
# open http://localhost:18080
```

Pin a version with `QUIZDOCK_TAG=0.7.0 docker compose -f docker-compose.prod.yml up -d`.
From source: `git clone https://github.com/quizdock/quiz-dock.git`, then the same command
with `--build`.

### Upgrading

Migrations run **automatically** on every start: pull the new tag and `up` again.
**Back up PostgreSQL first**, and **don't roll back** an image once its migrations ran —
restore the backup instead. With the script: `./quizdock upgrade 0.7.0` (backup → pull →
restart → doctor). Full procedure:
[self-hosting → Upgrading](https://github.com/quizdock/quiz-dock/blob/main/docs/self-hosting/upgrading.md).

## ⚙️ Configuration

Copy `.env.example` to `.env` and adjust. The settings you are most likely to touch:

| Variable | Default | Purpose |
|---|---|---|
| `APP_NAME` | `QuizDock` | App name shown in the UI (white-label) |
| `APP_LANG` | `en` | Instance language: `en` · `fr` · `es` · `zh` · `zh-TW` |
| `APP_LOGO_URL` | — | Logo served from elsewhere; empty = look in the mounted `branding/` folder |
| `AUTH_MODE` | `none` | `none` (local mode) or `oidc` (any OpenID Connect provider) |
| `HTTP_PORT` | `18080` | Host port for the app |
| `APP_PUBLIC_URL` | — | Public address of the instance, offered first as the invitation address (QR code, join link) |
| `DEMO_MODE` | `false` | Guards for an instance open to strangers: one shared host account, read-only templates, no uploads, hourly wipe |

Rebrand without rebuilding: set `APP_NAME` / `APP_LANG` and drop a `logo.<svg|avif|webp|png|jpg|jpeg|gif>`
+ `override.css` into the mounted `branding/` folder (or point `APP_LOGO_URL` at a logo
hosted elsewhere).

📖 **Self-hosting guide** — every variable, white-labeling and OIDC setup:
[`docs/self-hosting/`](https://github.com/quizdock/quiz-dock/tree/main/docs/self-hosting).

## 📸 Screenshots

<table>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/my-quizzes.png" alt="My quizzes" /><br /><sub><b>My quizzes</b> — your bank: search, filter, import / export, one click to present</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/templates.png" alt="Shared templates" /><br /><sub><b>Templates</b> — quizzes shared on the instance; take an independent copy</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/editor.png" alt="Quiz builder" /><br /><sub><b>Quiz builder</b> — 7 question types, video &amp; sound, slides, backgrounds, scoring rules</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/console-lobby.png" alt="Host console — lobby" /><br /><sub><b>Host console</b> — lobby: PIN, QR code, players in the room or remote, who hears the sound</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/join.png" alt="Join by PIN, nickname and avatar" /><br /><sub><b>Join</b> — PIN or QR code, nickname &amp; avatar, in the room or remote, no account</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/projection-question.png" alt="Projection — question" /><br /><sub><b>Projection</b> — live question on the big screen</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/player-play.png" alt="Player — question and reveal" /><br /><sub><b>Player</b> — colour tiles to tap, then own result</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/projection-reveal.png" alt="Projection — reveal" /><br /><sub><b>Reveal</b> — distribution, explanation, live leaderboard</sub></td>
  </tr>
</table>

More — content slides, the console during a question and at the reveal,
the podium, the player's ordering and feedback screens:
[full gallery](https://github.com/quizdock/quiz-dock/blob/main/docs/screenshots/README.md).

## 📋 More features

<details>
<summary>Everything else QuizDock does</summary>

- 📝 **Rich text** — prompts, options and descriptions in Markdown with a visual editor (bold, lists, code, inline images).
- 🎞️ **Content slides** — headings, text, images, 2–3 columns between questions; image or gradient backgrounds for slides and questions, with a faithful 16:9 preview.
- 💡 **Answer explanations** — shown at the reveal, with a per-question reveal delay in automatic mode.
- 🎛️ **Host in control** — Console / Projection / Participant views, look back over played questions without replaying anything, layout edits reach a running session at its next step, sessions survive a server restart.
- 🌐 **Remote participants** _(experimental)_ — a participant following from home says so when joining and gets the whole question on their device, sound and video included; the console shows who is remote and whose media are loaded.
- 📡 **Invitation address** — the QR code and join link point where participants can actually reach the instance (public URL, LAN IP, or any address), chosen from the console.
- ⭐ **Player feedback** — players rate the quiz (stars + optional comment) at the end; hosts see the distribution and browse the reviews. Can be switched off per quiz.
- 💾 **Answer capture** — optionally record every player's individual answers for audit, certification or individual follow-up.
- 🔎 **History & exploration** — browse archived sessions: per-question success rates, average times, per-player answer sheets.
- 📤 **CSV export** — overall results and per-player answer sheets.
- 📦 **Quiz import / export** — a quiz travels as a [portable bundle](https://github.com/quizdock/quiz-dock/blob/main/docs/quiz-bundle.md) (`quiz.json` + `media/`, zipped): back it up, move it between instances, share it — from the app or the operator CLI.
- 🌍 **Multilingual** — one language per instance; a [glossary](https://github.com/quizdock/quiz-dock/blob/main/apps/frontend/src/i18n/GLOSSARY.md) keeps the wording consistent across the five.
- 🎨 **White-label** — name, logo and CSS via env + a mounted folder, no rebuild.
- 🔒 **Hardened runtime** — distroless image, non-root, read-only root FS, all Linux capabilities dropped, `no-new-privileges`.

</details>

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

Design references live in [`specifications/`](https://github.com/quizdock/quiz-dock/blob/main/specifications/README.md);
ongoing notes and decisions in [`docs/`](https://github.com/quizdock/quiz-dock/blob/main/docs/README.md)
(see the [ADRs](https://github.com/quizdock/quiz-dock/tree/main/docs/adr)).

## 🔒 Security

<a href="https://github.com/quizdock/quiz-dock/actions/workflows/security.yml"><img alt="Security" src="https://img.shields.io/github/actions/workflow/status/quizdock/quiz-dock/security.yml?branch=main&logo=github&label=security" /></a>
<a href="https://github.com/quizdock/quiz-dock/tree/main/docs/security"><img alt="Scanned by Trivy" src="https://img.shields.io/badge/scanned%20by-Trivy-1904DA?logo=aqua&logoColor=white" /></a>

Dependencies and images are scanned on every push, every PR and weekly
([`Security` workflow](https://github.com/quizdock/quiz-dock/actions/workflows/security.yml)):
`pnpm audit` gates app CVEs, Trivy scans the filesystem and the published image (results in
the **Security** tab). Point-in-time audits live in
[`docs/security/`](https://github.com/quizdock/quiz-dock/tree/main/docs/security); report a
vulnerability via [`SECURITY.md`](https://github.com/quizdock/quiz-dock/blob/main/SECURITY.md).

## 📄 License

[MIT](https://github.com/quizdock/quiz-dock/blob/main/LICENSE) — free to use, modify and
redistribute, including for internal self-hosting, provided the copyright notice is kept.
