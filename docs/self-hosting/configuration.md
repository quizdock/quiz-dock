# Configuration

Operator guide for self-hosting QuizDock: how to start it, and every environment
variable. Two companion guides cover what deserves its own page:

- **[Branding (white-label)](branding.md)** — name, language, logo, CSS.
- **[Authentication](auth.md)** — local host seat, or your own OIDC provider.

---

## Run it

```bash
# One container, app + database in the same image (what the examples use)
docker run -p 18080:3000 -v quizdock:/data --env-file .env fchaussin/quizdock:standalone

# Compose: app + PostgreSQL + Redis + the one-shot migrate service
curl -O https://raw.githubusercontent.com/quizdock/quiz-dock/main/docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d          # reads the .env next to it

# The `quizdock` script: guided setup, then start, backup, upgrade
./quizdock init && ./quizdock up
```

**Start from an example.** Copy the one that fits into `.env` and adjust it — each is
commented, with only what that setup reads:

| File | For |
|---|---|
| [`env/standalone.env.example`](../../env/standalone.env.example) | one container (`:standalone`), the database inside; local mode — a first try, a laptop |
| [`env/local.env.example`](../../env/local.env.example) | Docker Compose with its own PostgreSQL, local mode — a classroom, a trusted network |
| [`env/oidc.env.example`](../../env/oidc.env.example) | Docker Compose with your identity provider — an organisation |

`./quizdock init` writes a `.env` of its own by asking; the root `.env.example` is the
development stack's, for contributors.

The examples in these guides use `:standalone` because it is the shortest to type; with
compose, the same variables go in the `.env` file next to `docker-compose.prod.yml` and
the container paths are identical. See the [CLI guide](cli.md) for the script, and the
[README quick start](../../README.md#-quick-start-self-host) for the three in context.

QuizDock is configured entirely through **environment variables** — no rebuild needed.
Where you set them depends on how you run it:

| Run mode | Where to set variables |
|---|---|
| `docker run` (e.g. `:standalone`) | `-e APP_LANG=fr` flags, or `--env-file .env` |
| `docker compose` (prod) | a `.env` file next to `docker-compose.prod.yml`, or the `environment:` block |
| Docker Desktop GUI | the container's **Environment variables** panel |

---

## Environment reference

### Identity & branding

| Variable | Default | Description |
|---|---|---|
| `APP_NAME` | `QuizDock` | Brand name shown in the header, tab title and share text. |
| `APP_LANG` | `en` | UI language for the instance: `en` · `fr` · `es` · `zh` · `zh-TW`. One per deployment (no browser detection). |
| `APP_LOGO_URL` | — | Logo served from somewhere else (a CDN, a path outside `branding/`). Empty by default, which is the usual setup: the logo is then looked up in the mounted `branding/` folder. |
| `APP_FEEDBACK_URL` | — | Where the home page's *Report a bug · Suggest a feature · Fix a translation · Ask a question* links lead. Empty: the QuizDock repository, its forms filled in with the version, the browser and the language. Another GitHub repository (`https://github.com/owner/repo`): the same forms there — copy `.github/ISSUE_TEMPLATE/` into it. Any other address: a single *Send feedback* link. `none`: no links. |

How to replace the logo and the stylesheet: **[branding](branding.md)**.

### Access & instance mode

| Variable | Default | Description |
|---|---|---|
| `AUTH_MODE` | `none` | `none` = local mode (no IdP, single host seat); `oidc` = validate JWTs from any OpenID Connect provider. |
| `DEMO_MODE` | `false` | `true` = public demo guards: the host seat lasts 5 min (renewable), media uploads are refused, and everything is wiped every hour. See below. |
| `ALLOW_ANONYMOUS_PARTICIPANTS` | `false` | `AUTH_MODE=oidc` only: `true` lets hosts open a game to participants without an account, the PIN and a nickname alone — chosen at each launch ([open access](auth.md#open-access-oidc)) |
| `OIDC_ISSUER` | — | `iss` expected in tokens (your provider's issuer URL). Required when `AUTH_MODE=oidc`. |
| `OIDC_JWKS_URI` | _(discovery)_ | JWKS endpoint. Default: `jwks_uri` from `${OIDC_ISSUER}/.well-known/openid-configuration`. Set it to target an internal host in Docker. |
| `OIDC_SESSION_SCOPE` | `browser` | Where the browser keeps the OIDC session: `browser` = shared by the tabs (a preview or a console opened in a new tab stays signed in); `tab` = each tab signs in on its own, e.g. on shared computers. |
| `OIDC_CLIENT_ID` | `quiz-dock-frontend` | Public SPA client id (sent to the browser via `GET /auth/config`). |
| `OIDC_AUDIENCE` | _(unset)_ | Expected `aud`. Left unset = audience check skipped. |
| `OIDC_ROLES_CLAIM` | `roles` | Dotted path to the roles array in the JWT (e.g. `groups`, `realm_access.roles`). |
| `OIDC_NAME_CLAIM` | _(unset)_ | Dotted path to the display-name claim (e.g. the standard `nickname`). Unset, or absent from a token: `preferred_username`, then `name`, then `email`. |

How the two modes behave, and how to register the client on your IdP:
**[authentication](auth.md)**.

### Infrastructure

| Variable | Default | Applies to | Description |
|---|---|---|---|
| `PORT` | `3000` | app | In-container HTTP port. Map it to a host port (`-p 18080:3000`). |
| `DATABASE_URL` | — | app, migrate | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/quizdock`. **Required** (provided by compose; baked into `:standalone`). |
| `REDIS_URL` | — | app | Redis connection string, e.g. `redis://host:6379`. Live-game state only. |
| `MEDIA_DIR` | `/data/media` | app | Where uploaded images, videos and sounds are stored. Mount a volume here to persist. |

The multi-service `docker-compose.prod.yml` also exposes:

| Variable | Default | Description |
|---|---|---|
| `HTTP_PORT` | `18080` | Host port mapped to the app. |
| `QUIZDOCK_TAG` | `latest` | Image tag to run (`0.4.0` to pin). |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `live` / `live` / `quizdock` | Bundled Postgres credentials (used to build `DATABASE_URL`). |

### Invitation address

| Variable | Default | Description |
|---|---|---|
| `APP_PUBLIC_URL` | — | Public address of the instance (`https://quiz.example.org`). Offered first as the invitation address (QR code, join link) on the host console. |
| `HOST_LAN_IPS` | — | Comma-separated LAN IPs of the machine (bare IPs), for setups where the container cannot see the host's interfaces (Docker Desktop, bridge network). Offered as invitation addresses with the scheme and port of the page. |

Which setup offers what: [where participants connect](invitation-address.md).

### Shared templates

| Variable | Default | What it does |
| --- | --- | --- |
| `STORE_DIR` | `/data/store` | Where the **catalogue of shared templates** lives (#39): `index.json` plus one folder per template, in the bundle format. Its own volume, like `MEDIA_DIR` — **back it up with the database**, it is not in PostgreSQL. Nothing here reaches the network: an instance with no egress shares and takes normally. Sharing is off on a demo instance. |

### Limits & game pacing

| Variable | Default | Description |
|---|---|---|
| `MEDIA_MAX_BYTES` | `10485760` | Max size of an uploaded **image** (bytes). Default 10 MiB. |
| `MEDIA_MAX_VIDEO_MB` | `50` | Max size of an uploaded **video** (MB). The editor converts to MP4 H.264 + AAC and compresses a long video to fit. |
| `MEDIA_MAX_AUDIO_MB` | `10` | Max size of an uploaded **sound** (MB). The editor converts to M4A (AAC). |
| `MEDIA_LIBRARY_LINKS` | *(seven free libraries)* | The free media libraries the editor links to: a JSON list of `{"name", "url", "kinds"}` (`kinds` among `image`, `video`, `audio`), or `none` to hide them (an instance without Internet). Default, open licences only and several per kind: OpenSoundLibrary, Freesound, ccMixter, Openverse, Wikimedia Commons, NASA Image and Video Library, Internet Archive. |
| `IMPORT_MAX_BYTES` | `52428800` | Max size of an imported quiz bundle (zip). Default 50 MiB. |

| `GAME_AUTO_ADVANCE_MS` | `5000` | Automatic mode: time spent on a reveal or a content slide before moving on, unless the question/slide sets its own. |
| `GAME_READ_DELAY_MS` | `3000` | Reading window shown before a question's timer starts. |
| `GAME_MEDIA_WAIT_S` | `10` | How long the room waits at most, before a question, for the devices that play its sound or video to load it (the host can start anyway). `0` never waits. See [audio & video](audio-video.md#waiting-for-media). |

Formats, conversion and playback are detailed in [Audio & video](audio-video.md).
The editor converts each media in the author's browser to one format per kind; the server
still reads a file's type from its content, never from its name. **Behind a reverse proxy, raise its request body limit to the largest of these
sizes** — nginx refuses anything over 1 MB by default (`client_max_body_size 50m;`).

---

## Ports & volumes

- The app listens on **`3000`** inside the container — publish it where you like (`-p 18080:3000`).
- **Media** persists under `MEDIA_DIR` (`/data/media`) — keep it on a volume.
- The **`:standalone`** image keeps PostgreSQL data under `/data/postgres`; mount a
  **named volume** at `/data` (`-v quizdock:/data`) so the database survives restarts.

---

## Public demo instance

Not to be confused with local mode: `AUTH_MODE` says *who may host* (a name, or an
OIDC account); `DEMO_MODE` says *the instance is open to strangers* and adds guards on
top. `DEMO_MODE=true` is meant for `:standalone` in local mode with no volume, where
anyone walks in, writes quizzes and runs sessions. The guards:

- **One shared host account, `demo_user`** (local mode). Whatever name a request carries,
  the server serves that account, which holds the host seat without expiry — nobody
  waits for a seat, and everyone sees and changes the same bank. Visitors may step on
  each other's quizzes and sessions; that is accepted, and said on the home page. The
  sign-in page is a single *Enter the demo* button; the seat controls and logging out
  never release the seat.
- **Read-only template catalogue.** The sample templates (France, Taiwan) are seeded
  and can be previewed and copied — the way back to something playable when someone
  emptied the shared bank — but sharing and withdrawing are refused
  (`403 store.demo_disabled`) and their buttons are hidden.
- **No media uploads** (`403 media.demo_disabled`, also for imported bundles that carry
  media). The upload buttons are hidden.
- **Hourly reset** to a blank install: users, quizzes, media, session archives, the seat
  and the live state — then `demo_user` and its seat are created again. A reset waits
  while a session is being played, at most 3 hours.

The SPA shows a banner saying so, and the **home page lists these guards in full** —
someone trying QuizDock there must be able to tell a guard of that instance from a limit
of the product, so the list ends by saying that a self-hosted instance has none of them.
When the app runs from the `:standalone` image it adds that image's own limits to the
list (application, database and cache in one container); the image announces itself
through `QUIZDOCK_FLAVOR=standalone`, which it sets on its own — an operator never has to.
The templates are never touched by the reset: the catalogue is a folder, not a table.
