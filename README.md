<p align="center">
  <img src="https://quizdock.github.io/logo.svg" width="220" alt="QuizDock" />
</p>

<h1 align="center">QuizDock</h1>

<p align="center">
  <strong>Open-source live quiz platform you can run on your own infrastructure.</strong>
</p>

<p align="center">
  <a href="https://github.com/quizdock/quiz-dock/releases"><img alt="Release" src="https://img.shields.io/github/v/release/quizdock/quiz-dock?logo=github&color=6f42c1" /></a>
  <a href="https://github.com/quizdock/quiz-dock/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/quizdock/quiz-dock/ci.yml?branch=main&logo=github&label=CI" /></a>
  <a href="https://github.com/quizdock/quiz-dock/actions/workflows/security.yml"><img alt="Security" src="https://img.shields.io/github/actions/workflow/status/quizdock/quiz-dock/security.yml?branch=main&logo=github&label=security" /></a>
  <a href="https://hub.docker.com/r/fchaussin/quizdock"><img alt="Docker pulls" src="https://img.shields.io/docker/pulls/fchaussin/quizdock?logo=docker&logoColor=white&label=pulls" /></a>
  <a href="https://hosted.weblate.org/engage/quizdock/"><img alt="Translation status" src="https://hosted.weblate.org/widget/quizdock/svg-badge.svg" /></a>
  <a href="https://github.com/quizdock/quiz-dock/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/quizdock/quiz-dock?color=blue" /></a>
</p>

<p align="center">
  <a href="https://quizdock.github.io"><b>Website</b></a> ·
  <a href="https://quizdock-standalone.onrender.com">Live demo</a> ·
  <a href="https://quizdock.github.io/docs/">Documentation</a> ·
  <a href="https://hub.docker.com/r/fchaussin/quizdock">Docker Hub</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/demo.gif" width="800" alt="The host's console, the big screen and a player's phone: players join by PIN, Léa answers first and right, the reveal, the standings, her podium" />
</p>

QuizDock is a live quiz you run yourself: a host presents a quiz on the big screen, players
join from their phones with a PIN or a QR code, and every result lands in your own
database. The product, its uses and its documentation are on
**[quizdock.github.io](https://quizdock.github.io)**; this repository is the code.

## Why QuizDock

- **Plug-and-play.** No identity provider to start: a host takes the seat by name, players
  join with a PIN. A setup wizard in the browser, sample quizzes, a script that backs up,
  upgrades and checks the instance. [More](https://quizdock.github.io/plug-and-play/)
- **Your infrastructure.** The application, PostgreSQL, Redis and a media volume. No
  telemetry, no third-party scripts in the pages; with the offline preset and local
  accounts, the server makes no outgoing request. [More](https://quizdock.github.io/self-hosted/)
- **Real time, measured.** The server sets every start and deadline and stamps every
  answer on arrival; the benchmarks are published with their method and limits.
  [More](https://quizdock.github.io/real-time/)
- **From a classroom to an organisation.** Local mode first, then your OpenID Connect
  provider with the same image: roles, a web administration, lockable settings, an audit
  trail. [More](https://quizdock.github.io/enterprise/)
- **Video and sound.** Media in questions and slides, converted in the browser, started on
  the server's clock; remote participants get them on their own device (experimental).
  [More](https://quizdock.github.io/media/)
- **Open source, MIT.** Docker images for amd64 and arm64, six interface languages.

## Quick start

The recommended way, with Docker Compose, PostgreSQL and Redis:

```sh
curl -fsSLO https://raw.githubusercontent.com/quizdock/quiz-dock/main/quizdock
chmod +x quizdock
./quizdock init
./quizdock up
```

Or one container to try it, at `http://localhost:18080`:

```sh
docker run -p 18080:3000 -v quizdock:/data fchaussin/quizdock:standalone
```

Other setups, OIDC and the full option with a bundled Keycloak:
[choose a deployment](https://quizdock.github.io/docs/operator/choose-a-deployment/).

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/editor.png" alt="Quiz builder" /><br /><sub><b>Quiz builder</b>: eight question types, slides, video and sound</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/console-lobby.png" alt="Host console, lobby" /><br /><sub><b>Host console</b>: PIN, QR code, who is in, the room's sound</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/player-play.png" alt="A player's phone" /><br /><sub><b>Player</b>: colour and shape on every answer, then their own result</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/projection-reveal.png" alt="Big screen, reveal" /><br /><sub><b>Big screen</b>: distribution, explanation, leaderboard</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/admin-settings.png" alt="Administration, settings" /><br /><sub><b>Administration</b>: every setting, where it comes from, changed from the page</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/quizdock/quiz-dock/main/docs/screenshots/media-library.png" alt="Media library" /><br /><sub><b>Media library</b>: your media and the instance's, with their credits</sub></td>
  </tr>
</table>

Every screen: [full gallery](https://github.com/quizdock/quiz-dock/blob/main/docs/screenshots/README.md).

## Performance

Rooms of 30 players playing at once, answers acknowledged (ms):

| Rooms | Players | p95 | p99 |
|--:|--:|--:|--:|
| 10 | 300 | 7 | 11 |
| 30 | 900 | 7 | 12 |
| 50 | 1500 | 9 | 14 |
| 60 | 1800 | 25 | 105 |

Measured on 2026-09-27: the backend pinned to one 2.1 GHz core, PostgreSQL and Redis on
the same machine, players simulated over loopback, no media, one run per step. Raw results
and method: [`docs/dev/load-results`](https://github.com/quizdock/quiz-dock/tree/main/docs/dev/load-results);
what it means for a server: [sizing](https://quizdock.github.io/docs/operator/sizing/).

## Administration and operations

A web administration: what is played right now, the last twelve months, every setting with
its source and help, accounts and roles, every quiz and media of the instance, health
checks, an audit of every action, and a setup wizard for a new instance. On the server,
`./quizdock` runs `status`, `doctor`, `backup`, `restore` and `upgrade`; every
administrative operation is a `qd` command too. A newer release is announced in the
administration. [Administration](https://quizdock.github.io/docs/admin/overview/) ·
[operations](https://quizdock.github.io/docs/operator/cli/).

## Features

<details>
<summary>Everything QuizDock does</summary>

- **Live quiz, in real time** — players join by 6-digit PIN or QR code from any
  device, no account; a Socket.IO engine with authoritative server timing keeps everyone
  in step; each player gets a generated [Multiavatar](https://multiavatar.com) avatar.
- **Made for the big screen** — bright, high-contrast projection screens, with
  separate projection and control windows; manual or automatic pacing.
- **A real quiz builder** — eight question types (single/multi choice, true-false,
  text, numeric, reorder, poll, and image choice — pictures as the answers), images with
  alternative text, Markdown everywhere, content
  slides between questions, backgrounds, answer explanations at the reveal. A new quiz
  starts from a draft: an intro slide and a first question to complete. Three sample
  quizzes wait in the templates (France, Taiwan, Türkiye), every question
  type in them, with pictures and sounds from Wikimedia Commons.
- **Video & sound** — videos and sounds in questions and slides,
  loudness-matched, drawn as a waveform with a playhead; played on the projection and on
  the devices of **remote participants** (who hears what is set per quiz, per question and
  per session), started on the same instant everywhere, fetched ahead from the lobby, and
  the room waits a moment for a device still loading. *Listen first* questions open the
  answers only once the media has played:
  [media](https://quizdock.github.io/docs/host/media/).
- **A media library** — drop any image, video or sound your browser reads: it is
  converted **in the browser** to one format per kind (WebP, MP4 H.264/AAC, M4A) and
  stored once, whoever uploads it again. *My images / videos / sounds* reuse what you
  uploaded; **global media** are what the instance provides to every host; each media
  carries its **credit** (author, licence, source), shown with the quiz and under the
  podium. Links to free libraries (Openverse, Wikimedia Commons, Freesound…).
- **Scoring that rewards speed** — time-weighted points, streak bonuses, the standings
  after each question, final podium; per-question rules (*closest answer wins*, partial
  credit, typo-tolerant text, double or fixed points).
- **Several quizzes in one room** — players join once and stay: after a quiz, everyone
  meets again in the room's lobby, where the host picks the next one, which starts on its
  own after 30 s or once everyone is ready, and the room keeps its own standings across the
  quizzes, shown live and kept in *History* with the results.
- **Self-hosted and private** — one Docker image (`amd64` / `arm64`), no SaaS, no
  telemetry, no ads; interface in English, French, Spanish, Simplified and Traditional
  Chinese, and Turkish — each host picks theirs, the big screen and the phones speak the
  quiz's language or the room's; rebrand name, logo and CSS without a rebuild.
- **An administration in the browser** — what is played right now and the last twelve
  months of use; every setting with its value, where it comes from and its help, changed
  from the page once the operator allows it; health checks, accounts and roles, every
  quiz of the instance (hand one over, export, archive), the media, and an audit of every
  action. A fresh instance opens on a setup wizard. Each operation is a `qd` command too:
  [administration](https://quizdock.github.io/docs/admin/overview/).
- **Rich text** — prompts, options and descriptions in Markdown with a visual editor (bold, lists, code).
- **Content slides** — headings, text, images, 2–3 columns between questions; image or gradient backgrounds for slides and questions, with a faithful 16:9 preview. A slide can play a video behind its content (looped or once, with its sound or muted) and a sound, set like a question's; in automatic mode it waits for them to play. Its text can name the quiz and the room — `{title}`, `{pin}`, `{players}`, `{question}` and more, filled wherever the slide shows.
- **Answer explanations** — shown at the reveal, with a per-question reveal delay in automatic mode.
- **Preview** — rehearse your quiz exactly as it will look on the big screen, answers shown.
- **Share with the other hosts** — one switch in a quiz's settings: the other hosts of the instance find it in their quizzes, marked with a lock, read it step by step (as it will show, and how each question is scored) and create their own copy from it. Off by default: a quiz stays yours alone.
- **Credits** — author, licence and source on every media, carried with a quiz when it is exported or shared; listed on the preview page and in small print under the podium, as a CC-BY licence asks.
- **Instance media** _(administrators)_ — disk used by kind and by owner, the clean-up (unused media, stray files, run it now), every file as a list or a grid, the chosen one beside it with its size in pixels, owners and usages (a sound on its waveform); global media uploaded or added from any file; a file deleted even when used (moderation), once its usages are listed.
- **Community quizzes** _(opt-in)_ — with `QUIZ_STORE_URL` set, the templates link to a community catalogue: filter by language and tags, preview, check the source and licence, take an independent draft. Off by default: no outgoing request. [Templates and community](https://quizdock.github.io/docs/host/templates-and-community/).
- **Media housekeeping** — each file stored once (SHA-256), unused media and stray files cleaned up hourly, older formats kept playing.
- **Host in control** — Console / Projection / Participant views, the space bar pauses and resumes the game, look back over played questions without replaying anything, layout edits reach a running session at its next step.
- **The sound in the host's hands** — from the console, play / pause the question's sound or video on every device at once, click or drag its waveform to a point, or take it back to the top; a waveform can be hidden from the screens and still show on the console; every start and stop fades, no clicks. The background track never plays over a question's own sound: it steps out and comes back; every mixer has a mute per channel. The game's own sounds, synthesised in the browser: a ding as a question appears, a tick per answer, a tick-tock on the last five seconds and a gong on zero — each can be switched off, previewed on the console, or replaced by a sound of the library.
- **Your bank at a glance** — My quizzes and the templates as a list or a grid (each quiz showing its first slide), filtered by status, owner, language and tags, each quiz with its size, language, date, licence and tags; archived quizzes kept out of the way.
- **Remote participants** _(experimental)_ — a participant following from home says so when joining and gets the whole question on their device, sound and video included; the console shows who is remote and whose media are loaded.
- **The projection on your own device** — a participant shares the big screen to a tablet or a computer (a link or a QR code, never their seat): it follows the projection, muted in the room, with sound for someone following from home. On the same phone, one tap switches between the answers and the big screen.
- **Ready!** — participants say they are ready in the lobby; the host sees one count, including whose media are still loading, and still starts when they choose. The lobby of a room's next quiz starts on its own once everyone is ready, or after 30 s unless the host stops the countdown.
- **Game sounds** — a tick at each answer, a gong at the reveal, a background track from your library while players answer (never over a question's own sound); set for the room from the lobby, kept from one quiz to the next. A sound button on every screen that plays something, a mixer for the room on the console, and one per device; *Without sound* for whoever prefers silence.
- **Players without an account** — where everyone signs in, a host can still open a game to the PIN and a nickname alone, for visitors or trainees who have no account; chosen at each launch, or once and for all in *My account*.
- **Keep the room to itself** — close the game to newcomers once everyone is in (or during play), remove a player, and guessing PINs is slowed down.
- **Invitation address** — the QR code and join link point where participants can actually reach the instance (public URL, LAN IP, or any address), chosen from the console.
- **Player feedback** — players rate the quiz (stars + optional comment) at the end; hosts see the distribution and browse the reviews. Can be switched off per quiz.
- **Answer capture** — optionally record every player's individual answers for audit, certification or individual follow-up.
- **History & exploration** — browse archived sessions: per-question success rates, average times, per-player answer sheets.
- **CSV export** — overall results and per-player answer sheets.
- **Licence, tags and language of a quiz** — set in the quiz settings and carried with it, so whoever receives a copy knows what they may do with it and what it is about.
- **Quiz import / export** — a quiz travels as a [portable bundle](https://github.com/quizdock/quiz-dock/blob/main/docs/quiz-bundle.md) (`quiz.json` + `media/`, zipped): back it up, move it between instances, share it — from the app or the operator CLI. Coming from Kahoot? Its spreadsheet template imports as a draft, the rows to finish flagged. From another tool, a [chatbot prompt](https://quizdock.github.io/docs/host/import-a-quiz/) turns a PDF, screenshots or a spreadsheet into a quiz to import, and a local [MCP connector](https://quizdock.github.io/docs/operator/cli/) _(experimental)_ lets a chatbot client check the quiz and import it itself.
- **Multilingual** — the instance's language by default, each host's own for their screens, the quiz's or the room's on the big screen and the phones; a [glossary](https://github.com/quizdock/quiz-dock/blob/main/apps/frontend/src/i18n/GLOSSARY.md) keeps the wording consistent across the six.
- **White-label** — name, logo and CSS via env + a mounted folder, no rebuild.
- **On the home screen** — an icon and a manifest: it can be added to a phone's or a tablet's home screen, and the screen stays on during a game.
- **Feedback** — under the version on the home page, links to report a bug, suggest a feature, fix a translation or ask a question, pre-filled with the version and the browser, and an invitation to star QuizDock on GitHub; pointed at your own repository or hidden with `APP_FEEDBACK_URL`.
- **Hardened runtime** — distroless image, non-root, read-only root FS, all Linux capabilities dropped, `no-new-privileges`; a Content-Security-Policy on every page (no inline script, no `eval`).

</details>

## Documentation

- [Hosting quizzes](https://quizdock.github.io/docs/host/getting-started/): create, present, read the results.
- [Administering an instance](https://quizdock.github.io/docs/admin/overview/): accounts, settings, quizzes, media, health, audit.
- [Operating it](https://quizdock.github.io/docs/operator/choose-a-deployment/): install, configure, back up, upgrade.
- [Changelog](CHANGELOG.md).

## Tech stack

**Backend** NestJS + Socket.IO · Prisma 7 / PostgreSQL · Redis (live state) ·
**Frontend** React + Vite + shadcn/ui + TanStack · i18next ·
**Packaging** single distroless image · Docker Compose. Front/back are kept in sync via an
auto-generated OpenAPI client (Orval) and a shared TypeScript WebSocket contract.

## Translations

QuizDock speaks English, French, Spanish, Turkish and Chinese (simplified and traditional).
Missing your language, or spotted an awkward word? Translate it on
[Weblate](https://hosted.weblate.org/engage/quizdock/), right in the browser, no setup needed;
new languages are welcome. Changes come back as pull requests to `dev`.

<a href="https://hosted.weblate.org/engage/quizdock/"><img alt="Translation status" src="https://hosted.weblate.org/widget/quizdock/horizontal-auto.svg" /></a>

## Development

Dev runs backend (NestJS, hot-reload) and frontend (Vite) as separate services. To send a
change, see [CONTRIBUTING.md](CONTRIBUTING.md): pull requests go to `dev`.

```bash
pnpm install
docker compose up -d
# Front: http://localhost:15173   ·   API: http://localhost:13000   ·   API docs: http://localhost:13000/api/docs
```

With `AUTH_MODE=oidc`, the dev stack's Keycloak has two accounts: `host` / `animateur`
(roles host and admin) and `player` / `participant`. Its own console is
http://localhost:18080 (`admin` / `admin`), to manage Keycloak, not QuizDock.

A hundred ready quizzes to stress the lists (`[stress]` titles, given to the host-seat holder;
`--count N`, `--owner <subject>`, `--clean` to remove them):
`pnpm --filter @quiz-dock/backend db:seed-stress`.

Design references live in [`specifications/`](https://github.com/quizdock/quiz-dock/blob/main/specifications/README.md);
ongoing notes and decisions in [`docs/`](https://github.com/quizdock/quiz-dock/blob/main/docs/README.md)
(see the [ADRs](https://github.com/quizdock/quiz-dock/tree/main/docs/adr)).

## Security

<a href="https://github.com/quizdock/quiz-dock/actions/workflows/security.yml"><img alt="Security" src="https://img.shields.io/github/actions/workflow/status/quizdock/quiz-dock/security.yml?branch=main&logo=github&label=security" /></a>
<a href="https://github.com/quizdock/quiz-dock/tree/main/docs/security"><img alt="Scanned by Trivy" src="https://img.shields.io/badge/scanned%20by-Trivy-1904DA?logo=aqua&logoColor=white" /></a>

Dependencies and images are scanned on every push, every PR and weekly
([`Security` workflow](https://github.com/quizdock/quiz-dock/actions/workflows/security.yml)):
`pnpm audit` gates app CVEs, Trivy scans the filesystem and the published image (results in
the **Security** tab). Point-in-time audits live in
[`docs/security/`](https://github.com/quizdock/quiz-dock/tree/main/docs/security); report a
vulnerability via [`SECURITY.md`](https://github.com/quizdock/quiz-dock/blob/main/SECURITY.md).

## License

[MIT](https://github.com/quizdock/quiz-dock/blob/main/LICENSE) — free to use, modify and
redistribute, including for internal self-hosting, provided the copyright notice is kept.
