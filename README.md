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
  <img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/demo.gif" width="800" alt="A session on the big screen: the intro slide, questions with their timers and answers coming in, the reveals" />
</p>

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
- 🧩 **A real quiz builder** — eight question types (single/multi choice, true-false,
  text, numeric, reorder, poll, and image choice — pictures as the answers), images with
  alternative text, Markdown everywhere, content
  slides between questions, backgrounds, answer explanations at the reveal. A new quiz
  starts from a draft: an intro slide and a first question to complete. Three sample
  quizzes wait in the templates (France, Taiwan, Türkiye), every question
  type in them, with pictures and sounds from Wikimedia Commons.
- 🎧 **Video & sound** — videos and sounds in questions and slides,
  loudness-matched, drawn as a waveform with a playhead; played on the projection and on
  the devices of **remote participants** (who hears what is set per quiz, per question and
  per session), started on the same instant everywhere, fetched ahead from the lobby, and
  the room waits a moment for a device still loading. *Listen first* questions open the
  answers only once the media has played. Tested in Chromium browsers, not yet on iPhone:
  [audio & video guide](https://github.com/quizdock/quiz-dock/blob/main/docs/self-hosting/audio-video.md).
- 🗂️ **A media library** — drop any image, video or sound your browser reads: it is
  converted **in the browser** to one format per kind (WebP, MP4 H.264/AAC, M4A) and
  stored once, whoever uploads it again. *My images / videos / sounds* reuse what you
  uploaded; **global media** are what the instance provides to every host; each media
  carries its **credit** (author, licence, source), shown with the quiz and under the
  podium. Links to free libraries (Openverse, Wikimedia Commons, Freesound…).
- 🏆 **Scoring that rewards speed** — time-weighted points, streak bonuses, leaderboard
  between questions, final podium; per-question rules (*closest answer wins*, partial
  credit, typo-tolerant text, double or fixed points).
- 🔁 **Several quizzes in one room** — players join once and stay: the host picks the
  next quiz at the podium, everyone meets again in its lobby, and the room keeps its
  own standings across the quizzes, shown live and kept in *History* with the results.
- 🏠 **Self-hosted and private** — one Docker image (`amd64` / `arm64`), no SaaS, no
  tracking, no ads; interface in English, French, Spanish, Simplified and Traditional
  Chinese, and Turkish; rebrand name, logo and CSS without a rebuild.

## 📈 Performance

Rooms of 30 players playing at once, the engine on one 2.1 GHz core (answers acknowledged, ms):

| Rooms | Players | p95 | p99 |
|--:|--:|--:|--:|
| 10 | 300 | 7 | 11 |
| 30 | 900 | 7 | 12 |
| 50 | 1500 | 9 | 14 |
| 60 | 1800 | 25 | 105 |

All measures, method and limits: [`docs/dev/load-results`](https://github.com/quizdock/quiz-dock/tree/main/docs/dev/load-results).

## 🔑 Two ways to run it

Same image, one switch: `AUTH_MODE` decides who can host.

|  | **Local mode** — `AUTH_MODE=none` (default) | **OIDC mode** — `AUTH_MODE=oidc` |
|---|---|---|
| Made for | a classroom, a meeting room, a trusted network | an organisation with an identity provider |
| Setup | none — start the container and play | point the app at your OpenID Connect provider (Keycloak, Authentik, Entra ID, Google…) |
| Who hosts | one **host seat**: a host signs in with just a name and takes it; released when done | as many hosts as you like, each signing in through your IdP with their own quizzes |
| Host rights | whoever holds the seat | the `host` role, granted from the IdP |
| Sample quizzes | in the templates | in the templates |

Players sign in only in OIDC mode, and there too a host can open a game to the PIN and a
nickname alone once the admin allows it (`ALLOW_ANONYMOUS_PARTICIPANTS=true`). Details: [authentication](https://github.com/quizdock/quiz-dock/blob/main/docs/self-hosting/auth.md).

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
To compare local, standalone, your own OIDC provider and bundled Keycloak, see
[choose a setup](docs/self-hosting/setups.md). Use `./quizdock init --full` for the
bundled Keycloak preset.

### Docker Compose by hand

```bash
curl -O https://raw.githubusercontent.com/quizdock/quiz-dock/main/docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d
# open http://localhost:18080
```

Pin a version with `QUIZDOCK_TAG=0.10.0 docker compose -f docker-compose.prod.yml up -d`.
From source: `git clone https://github.com/quizdock/quiz-dock.git`, then the same command
with `--build`.

### Upgrading

Migrations run **automatically** on every start: pull the new tag and `up` again.
**Back up PostgreSQL first**, and **don't roll back** an image once its migrations ran —
restore the backup instead. With the script: `./quizdock upgrade 0.10.0` (backup → pull →
restart → doctor). Full procedure:
[self-hosting → Upgrading](https://github.com/quizdock/quiz-dock/blob/main/docs/self-hosting/upgrading.md).

## ⚙️ Configuration

Start from the example that fits — [one container](https://github.com/quizdock/quiz-dock/blob/main/env/standalone.env.example),
[Compose in local mode](https://github.com/quizdock/quiz-dock/blob/main/env/local.env.example) or
[Compose with your identity provider](https://github.com/quizdock/quiz-dock/blob/main/env/oidc.env.example) —
copy it to `.env` and adjust. The settings you are most likely to touch:

| Variable | Default | Purpose |
|---|---|---|
| `APP_NAME` | `QuizDock` | App name shown in the UI (white-label) |
| `APP_LANG` | `en` | Instance language: `en` · `fr` · `es` · `zh` · `zh-TW` · `tr` |
| `APP_LOGO_URL` | — | Logo served from elsewhere; empty = look in the mounted `branding/` folder |
| `APP_FEEDBACK_URL` | — | Where the home page's *report a bug / suggest a feature…* links lead; empty = this repository, `none` = hidden |
| `AUTH_MODE` | `none` | `none` (local mode) or `oidc` (any OpenID Connect provider) |
| `ALLOW_ANONYMOUS_PARTICIPANTS` | `false` | OIDC mode: let hosts open a game to participants without an account |
| `HTTP_PORT` | `18080` | Host port for the app |
| `APP_PUBLIC_URL` | — | Public address of the instance, offered first as the invitation address (QR code, join link) |
| `DEMO_MODE` | `false` | Guards for an instance open to strangers: one shared host account, read-only templates, no uploads, hourly wipe |
| `MEDIA_LIBRARY_LINKS` | *(seven free libraries)* | Free media libraries the editor links to (JSON list), or `none` |

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
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/editor.png" alt="Quiz builder" /><br /><sub><b>Quiz builder</b> — 8 question types, video &amp; sound, slides, backgrounds, scoring rules</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/console-lobby.png" alt="Host console — lobby" /><br /><sub><b>Host console</b> — the room's lobby: PIN, QR code, players in the room or remote and who is ready, the game's sounds</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/media-library.png" alt="My media" /><br /><sub><b>My media</b> — reuse what you uploaded, sizes and usages; global media one tab away</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/admin-media.png" alt="Instance media" /><br /><sub><b>Instance media</b> — disk, clean-up, every file with its owners, the global media</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/projection-lobby.png" alt="Projection — lobby" /><br /><sub><b>Projection</b> — the big screen while players join and get ready</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/console-lobby-access.png" alt="Host console — closed room" /><br /><sub><b>Close the room</b> — once everyone is in, nobody else joins, even with the PIN</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/join.png" alt="Join by PIN, nickname and avatar" /><br /><sub><b>Join</b> — PIN or QR code, nickname &amp; avatar, in the room or remote, no account</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/projection-media.png" alt="Projection — question with a picture" /><br /><sub><b>Projection</b> — live question on the big screen, with its picture</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/player-play.png" alt="Player — question and reveal" /><br /><sub><b>Player</b> — colour tiles to tap, then own result</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/projection-reveal.png" alt="Projection — reveal" /><br /><sub><b>Reveal</b> — distribution, explanation, live leaderboard</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/types/image-choice.png" alt="Projection — image choice" /><br /><sub><b>Image choice</b> — pictures as the answers, each with its colour and shape</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/player-big-screen.png" alt="Remote player — the question, or the big screen" /><br /><sub><b>Remote player</b> — the whole question on their phone, or the big screen itself</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/projection-podium.png" alt="Podium" /><br /><sub><b>Podium</b> — final results on the big screen</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/types/slide-gradient.png" alt="Slide with a picture" /><br /><sub><b>Slides</b> — pictures, text, backgrounds, a video or a sound</sub></td>
  </tr>
</table>

More — every question type and slide on the big screen, the builder of an image choice and
of a slide, the console during a question, a slide and the reveal, the podium, the player's
ordering and feedback screens, the global media, the account preferences:
[full gallery](https://github.com/quizdock/quiz-dock/blob/main/docs/screenshots/README.md).

## 📋 More features

<details>
<summary>Everything else QuizDock does</summary>

- 📝 **Rich text** — prompts, options and descriptions in Markdown with a visual editor (bold, lists, code).
- 🎞️ **Content slides** — headings, text, images, 2–3 columns between questions; image or gradient backgrounds for slides and questions, with a faithful 16:9 preview. A slide can play a video behind its content (looped or once, with its sound or muted) and a sound, set like a question's; in automatic mode it waits for them to play. Its text can name the quiz and the room — `{title}`, `{pin}`, `{players}`, `{question}` and more, filled wherever the slide shows.
- 💡 **Answer explanations** — shown at the reveal, with a per-question reveal delay in automatic mode.
- 👁️ **Preview** — rehearse your quiz exactly as it will look on the big screen, answers shown.
- 🤝 **Share with the other hosts** — one switch in a quiz's settings: the other hosts of the instance find it in their quizzes, marked with a lock, read it step by step (as it will show, and how each question is scored) and create their own copy from it. Off by default: a quiz stays yours alone.
- 🧾 **Credits** — author, licence and source on every media, carried with a quiz when it is exported or shared; listed on the preview page and in small print under the podium, as a CC-BY licence asks.
- 🗄️ **Instance media** _(administrators)_ — disk used by kind and by owner, the clean-up (unused media, stray files, run it now), every file with its size in pixels, owners and usages, as a list or a grid with a preview (sound on its waveform); global media uploaded or added from any file; a file deleted even when used (moderation), once its usages are listed.
- 🧹 **Media housekeeping** — each file stored once (SHA-256), unused media and stray files cleaned up hourly, older formats kept playing.
- 🎛️ **Host in control** — Console / Projection / Participant views, the space bar pauses and resumes the game, look back over played questions without replaying anything, layout edits reach a running session at its next step, sessions survive a server restart.
- 🎚️ **The sound in the host's hands** — from the console, play / pause the question's sound or video on every device at once, click or drag its waveform to a point, or take it back to the top; a waveform can be hidden from the screens and still show on the console; every start and stop fades, no clicks. The background track never plays over a question's own sound: it steps out and comes back; every mixer has a mute per channel. The game's own sounds, synthesised in the browser: a ding as a question appears, a tick per answer, a tick-tock on the last five seconds and a gong on zero — each can be switched off, previewed on the console, or replaced by a sound of the library.
- 🗂️ **Your bank at a glance** — My quizzes and the templates as a list or a grid (each quiz showing its first slide), filtered by status, owner, language and tags, each quiz with its size, language, date, licence and tags; archived quizzes kept out of the way.
- 🌐 **Remote participants** _(experimental)_ — a participant following from home says so when joining and gets the whole question on their device, sound and video included; the console shows who is remote and whose media are loaded.
- 📺 **The projection on your own device** — a participant shares the big screen to a tablet or a computer (a link or a QR code, never their seat): it follows the projection, muted in the room, with sound for someone following from home. On the same phone, one tap switches between the answers and the big screen.
- ✋ **Ready!** — participants say they are ready in the lobby; the host sees one count, including whose media are still loading, and still starts when they choose.
- 🔔 **Game sounds** — a tick at each answer, a gong at the reveal, a background track from your library while players answer (never over a question's own sound); set for the room from the lobby, kept from one quiz to the next. A sound button on every screen that plays something, a mixer for the room on the console, and one per device; *Without sound* for whoever prefers silence.
- 🔓 **Players without an account** — where everyone signs in, a host can still open a game to the PIN and a nickname alone, for visitors or trainees who have no account; chosen at each launch, or once and for all in *My account*.
- 🛡️ **Keep the room to itself** — close the game to newcomers once everyone is in (or during play), remove a player, and guessing PINs is slowed down.
- 📡 **Invitation address** — the QR code and join link point where participants can actually reach the instance (public URL, LAN IP, or any address), chosen from the console.
- ⭐ **Player feedback** — players rate the quiz (stars + optional comment) at the end; hosts see the distribution and browse the reviews. Can be switched off per quiz.
- 💾 **Answer capture** — optionally record every player's individual answers for audit, certification or individual follow-up.
- 🔎 **History & exploration** — browse archived sessions: per-question success rates, average times, per-player answer sheets.
- 📤 **CSV export** — overall results and per-player answer sheets.
- 🏷️ **Licence, tags and language of a quiz** — set in the quiz settings and carried with it, so whoever receives a copy knows what they may do with it and what it is about.
- 📦 **Quiz import / export** — a quiz travels as a [portable bundle](https://github.com/quizdock/quiz-dock/blob/main/docs/quiz-bundle.md) (`quiz.json` + `media/`, zipped): back it up, move it between instances, share it — from the app or the operator CLI. Coming from Kahoot? Its spreadsheet template imports as a draft, the rows to finish flagged. From another tool, a [chatbot prompt](https://github.com/quizdock/quiz-dock/blob/main/docs/self-hosting/import-from-other-tools.md) turns a PDF, screenshots or a spreadsheet into a quiz to import, and a local [MCP connector](https://github.com/quizdock/quiz-dock/blob/main/docs/self-hosting/mcp.md) _(experimental)_ lets a chatbot client check the quiz and import it itself.
- 🌍 **Multilingual** — one language per instance; a [glossary](https://github.com/quizdock/quiz-dock/blob/main/apps/frontend/src/i18n/GLOSSARY.md) keeps the wording consistent across the six.
- 🎨 **White-label** — name, logo and CSS via env + a mounted folder, no rebuild.
- 💬 **Feedback** — under the version on the home page, links to report a bug, suggest a feature, fix a translation or ask a question, pre-filled with the version and the browser; pointed at your own repository or hidden with `APP_FEEDBACK_URL`.
- 🔒 **Hardened runtime** — distroless image, non-root, read-only root FS, all Linux capabilities dropped, `no-new-privileges`; a Content-Security-Policy on every page (no inline script, no `eval`).

</details>

## 🧱 Tech stack

**Backend** NestJS + Socket.IO · Prisma 7 / PostgreSQL · Redis (live state) ·
**Frontend** React + Vite + shadcn/ui + TanStack · i18next ·
**Packaging** single distroless image · Docker Compose. Front/back are kept in sync via an
auto-generated OpenAPI client (Orval) and a shared TypeScript WebSocket contract.

## 🛠️ Development

Dev runs backend (NestJS, hot-reload) and frontend (Vite) as separate services. To send a
change, see [CONTRIBUTING.md](CONTRIBUTING.md): pull requests go to `dev`.

```bash
pnpm install
docker compose up -d
# Front: http://localhost:15173   ·   API: http://localhost:13000   ·   API docs: http://localhost:13000/api/docs
```

A hundred ready quizzes to stress the lists (`[stress]` titles, given to the host-seat holder;
`--count N`, `--owner <subject>`, `--clean` to remove them):
`pnpm --filter @quiz-dock/backend db:seed-stress`.

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

## 🙏 Acknowledgements

Thanks to [Anthropic](https://www.anthropic.com) ([@anthropics](https://github.com/anthropics)) for the
[Claude Code](https://github.com/anthropics/claude-code) cloud credits that made the optimisation,
clean-up and testing work of 0.10.0 much easier.

## 📄 License

[MIT](https://github.com/quizdock/quiz-dock/blob/main/LICENSE) — free to use, modify and
redistribute, including for internal self-hosting, provided the copyright notice is kept.
