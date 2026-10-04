<p align="center">
  <img src="https://quizdock.github.io/logo.svg" width="200" alt="QuizDock" />
</p>

<h1 align="center">QuizDock</h1>

<p align="center">
  <strong>Open-source live quiz platform you run on your own infrastructure.</strong>
</p>

<p align="center">
  <a href="https://quizdock.github.io">Website</a> ·
  <a href="https://quizdock.github.io/docs/">Documentation</a> ·
  <a href="https://quizdock-standalone.onrender.com">Live demo</a> ·
  <a href="https://github.com/quizdock/quiz-dock">Source code</a>
</p>

QuizDock is an open-source (MIT) live quiz platform for classrooms, teams and events: a
big screen for the room, a phone for each player, every result in your own database.
These images are the quickest reproducible way to run it on your own infrastructure.

<p align="center">
  <img src="https://quizdock.github.io/demo.gif" width="800" alt="A session on the big screen: the intro slide, questions with their timers and answers coming in, the reveals" />
</p>

## Quick start

```sh
docker run -p 18080:3000 -v quizdock:/data fchaussin/quizdock:standalone
```

Open `http://localhost:18080`. The `:standalone` image carries its own PostgreSQL and
Redis, and keeps everything in the `quizdock` volume (`/data`). It is meant for a first
try or a small trusted network, not for production: it is not hardened like the main
image.

For a lasting instance, use the `quizdock` script: a guided install with Docker Compose,
PostgreSQL and Redis, plus backups and upgrades.

```sh
curl -fsSLO https://raw.githubusercontent.com/quizdock/quiz-dock/main/quizdock
chmod +x quizdock
./quizdock init
./quizdock up
```

## Which setup?

| Need | Setup | Start with |
|---|---|---|
| Try QuizDock on your machine | One container, `:standalone` | `docker run …` above |
| A lasting instance, no identity provider | Compose: app + PostgreSQL + Redis | `./quizdock init` |
| Sign-in through your OpenID Connect provider | Compose, `AUTH_MODE=oidc` | `./quizdock init`, then [OIDC](https://quizdock.github.io/docs/operator/oidc/) |
| A full evaluation with a bundled Keycloak | Compose + Keycloak | `./quizdock init --full` |

Details: [choose a deployment](https://quizdock.github.io/docs/operator/choose-a-deployment/).

## Where the data lives

| What | `:standalone` | Compose (`./quizdock init`) |
|---|---|---|
| Database (quizzes, accounts, results) | `/data/postgres` in the `quizdock` volume | `pgdata` volume (PostgreSQL 16) |
| Live game state | inside the container (Redis) | `redisdata` volume (Redis 7) |
| Media | `/data/media` | `mediadata` volume, `/data/media` |
| Shared templates | `/data/store` | `storedata` volume, `/data/store` |
| Configuration | `docker run -e …` / `--env-file` | `.env` next to the script |

Back up the media and templates with the database: they are not in PostgreSQL.
`./quizdock backup` does all of it.

## Configuration

The variables most instances set:

| Variable | Default | What it does |
|---|---|---|
| `APP_NAME` | `QuizDock` | The name in the header, the tab title and share texts. |
| `APP_LANG` | `en` | The instance's interface language, by default (a host may pick theirs; the big screen and the phones speak the quiz's or the room's): `en`, `fr`, `es`, `zh`, `zh-TW`, `tr`. |
| `AUTH_MODE` | `none` | `none`: local mode, no identity provider, one host seat. `oidc`: sign-in with your provider. |
| `APP_PUBLIC_URL` | — | The public address, offered first as the invitation address (QR code, join link). |
| `ALLOW_ANONYMOUS_PARTICIPANTS` | `false` | OIDC mode only: lets hosts open a game to a PIN and a nickname. |
| `MEDIA_LIBRARY_LINKS` | seven free libraries | The free media libraries the editor links to; `none` hides them. |
| `UPDATE_CHECK` | `true` | Asks GitHub, at most once a day, whether a newer release is out; `false` turns it off. |

Every variable: [environment reference](https://quizdock.github.io/docs/operator/configuration/).
About half of them can also be changed from the web administration, once the operator allows it.

## Screenshots

<table>
  <tr>
    <td><img src="https://quizdock.github.io/screenshots/console-question.png" alt="The host console during a question" /></td>
    <td><img src="https://quizdock.github.io/screenshots/player-play.png" alt="A player's phone during a question" /></td>
  </tr>
  <tr>
    <td><img src="https://quizdock.github.io/screenshots/projection-reveal.png" alt="The big screen at the reveal" /></td>
    <td><img src="https://quizdock.github.io/screenshots/admin-settings.png" alt="The web administration's settings" /></td>
  </tr>
</table>

## Operate it

On the server, in the instance's folder:

```sh
./quizdock status            # containers, health, the version running and the latest release
./quizdock doctor            # checks the configuration, database, migrations, Redis, folders, OIDC
./quizdock backup            # database dump + media + templates + .env
./quizdock upgrade 0.13.1    # backup, pull, restart with the migrations, then doctor
```

A newer release is also announced in the web administration, with its notes and the
command to run. Nothing is installed from the web. Details:
[CLI](https://quizdock.github.io/docs/operator/cli/) ·
[upgrade](https://quizdock.github.io/docs/operator/upgrade/).

## Tags

One release, one version, the same QuizDock in every image.

| Tag | What it is |
|---|---|
| `X.Y.Z` (e.g. `0.13.1`) | An exact release of the main image. |
| `X.Y` | The latest patch of a minor version. |
| `latest` | The current stable release. |
| `standalone` | The all-in-one image of the current stable release. |
| `standalone-X.Y.Z` | The all-in-one image of an exact release. |

Every image is published for `linux/amd64` and `linux/arm64`. The main image is
distroless and runs as a non-root user.

## Documentation

- [Hosting quizzes](https://quizdock.github.io/docs/host/getting-started/)
- [Administering an instance](https://quizdock.github.io/docs/admin/overview/)
- [Operating it](https://quizdock.github.io/docs/operator/choose-a-deployment/)

Licence: MIT.
