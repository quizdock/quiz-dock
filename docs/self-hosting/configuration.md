# Configuration

Operator guide for self-hosting QuizDock: how to start it, and every environment
variable. Two companion guides cover what deserves its own page:

- **[Choose a setup](setups.md)** — compare the four installation options.
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
# Or: ./quizdock init --full && ./quizdock up (bundled Keycloak)
```

**Start from an example.** Copy the one that fits into `.env` and adjust it — each is
commented, with only what that setup reads:

| File | For |
|---|---|
| [`env/standalone.env.example`](../../env/standalone.env.example) | one container (`:standalone`), the database inside; local mode — a first try, a laptop |
| [`env/local.env.example`](../../env/local.env.example) | Docker Compose with its own PostgreSQL, local mode — a classroom, a trusted network |
| [`env/oidc.env.example`](../../env/oidc.env.example) | Docker Compose with your identity provider — an organisation |
| [`env/full.env.example`](../../env/full.env.example) | Docker Compose with bundled Keycloak and sample accounts |

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

<!-- BEGIN environment reference: generated from the settings registry (pnpm generate:settings-docs) -->

Level: **C1** critical (start-up, data, security — shown, never changed by the administration) · **C2** access and resources · **C3** behaviour · **C4** look and wording.

### Identity & branding

| Variable | Default | Accepts | Level | Description |
|---|---|---|---|---|
| `APP_NAME` | `QuizDock` | 1 to 40 characters | C4 | Brand name shown in the header, tab title and share text. |
| `APP_LANG` | `en` | `en` · `fr` · `es` · `zh` · `zh-TW` · `tr` | C4 | UI language for the instance. One per deployment (no browser detection). New quizzes start in this language; each quiz can be set to another in its settings. |
| `APP_LOGO_URL` | — | an `https://` URL | C4 | Logo served from somewhere else (a CDN, a path outside `branding/`). Empty by default, which is the usual setup: the logo is then looked up in the mounted `branding/` folder. |
| `APP_FEEDBACK_URL` | — | an `http(s)://` URL, or `none` | C4 | Where the home page's *Report a bug · Suggest a feature · Fix a translation · Ask a question* links lead. Empty: the QuizDock repository, its forms filled in with the version, the browser and the language. Another GitHub repository (`https://github.com/owner/repo`): the same forms there — copy `.github/ISSUE_TEMPLATE/` into it. Any other address: a single *Send feedback* link. `none`: no links. |

How to replace the logo and the stylesheet: **[branding](branding.md)**.

### Access & authentication

| Variable | Default | Accepts | Level | Description |
|---|---|---|---|---|
| `AUTH_MODE` | `none` | `none` · `oidc` | C1 | `none` = local mode (no IdP, single host seat); `oidc` = sign-in with any OpenID Connect provider, the session held by the backend. |
| `DEMO_MODE` | `false` | `true` · `false` | C1 | `true` = public demo guards: the host seat lasts 5 min (renewable), media uploads are refused, and everything is wiped every hour. |
| `ALLOW_ANONYMOUS_PARTICIPANTS` | `false` | `true` · `false` | C2 | `AUTH_MODE=oidc` only: `true` lets hosts open a game to participants without an account, the PIN and a nickname alone — chosen at each launch. |
| `OIDC_ISSUER` | — | an `http(s)://` URL, without query or fragment | C1 | `iss` expected in tokens (your provider's issuer URL). Required when `AUTH_MODE=oidc`. |
| `OIDC_CLIENT_ID` | `quiz-dock-frontend` | text | C1 | The client registered with your provider. |
| `OIDC_CLIENT_SECRET` | — | text | C1 | Its secret, for a confidential client. Unset: a public client, protected by PKCE. |
| `OIDC_INTERNAL_URL` | _(host of `OIDC_JWKS_URI`)_ | an `http(s)://` URL | C1 | Where the backend reaches the provider when the browser's address is not reachable from its network (Docker): discovery, tokens and keys go through it. Defaults to the host of `OIDC_JWKS_URI` when that one points elsewhere than the issuer. |
| `OIDC_JWKS_URI` | _(discovery)_ | an `http(s)://` URL | C1 | Key endpoint, when discovery's must not be used. |
| `OIDC_AUDIENCE` | — | text | C1 | Expected `aud`. Left unset = audience check skipped. |
| `OIDC_ROLES_CLAIM` | `roles` | a dotted path | C1 | Dotted path to the roles array in the JWT (e.g. `groups`, `realm_access.roles`). A typo locks every administrator out. |
| `OIDC_NAME_CLAIM` | — | a dotted path | C3 | Dotted path to the display-name claim (e.g. the standard `nickname`). Unset, or absent from a token: `preferred_username`, then `name`, then `email`. |

How the two modes behave, how to register the client on your IdP and what open access means:
**[authentication](auth.md)**. The public demo guards are described [below](#public-demo-instance).

### Network & invitation

| Variable | Default | Accepts | Level | Description |
|---|---|---|---|---|
| `PORT` | `3000` | a port | C1 | In-container HTTP port. Map it to a host port (`-p 18080:3000`). |
| `TRUST_PROXY` | _(private addresses)_ | `false`, `true`, a number of proxies, or addresses and CIDR ranges | C1 | Which hops may speak for the client through `X-Forwarded-For` / `X-Forwarded-Proto` (client address of the wrong-PIN limit, `Secure` session cookie). Default: a peer on a private address. |
| `APP_PUBLIC_URL` | — | an `http(s)://` URL, without path | C3 | Public address of the instance. Offered first as the invitation address (QR code, join link) on the host console. |
| `HOST_LAN_IPS` | — | comma-separated IPv4 addresses | C3 | Comma-separated LAN IPs of the machine (bare IPs), for setups where the container cannot see the host's interfaces (Docker Desktop, bridge network). Offered as invitation addresses with the scheme and port of the page. |
| `QUIZ_STORE_URL` | _(disabled)_ | up to five comma-separated `http(s)://` URLs | C2 | Comma-separated registry URLs of the community catalogue. Leave unset or empty to hide the community page and prevent all outgoing store requests. Enabling contacts the listed services from the server: its IP is visible, no user data is sent. |
| `QUIZ_STORE_HOSTS` | `github.com,release-assets.githubusercontent.com` | comma-separated host names | C2 | Additional exact host names allowed for source indexes, artifacts and redirects. Registry hosts are allowed automatically. Empty: the registry hosts only. |

Which setup offers which invitation address: [where participants connect](invitation-address.md).
The community catalogue, its formats and download checks: [community store](community-store.md).

### Storage

| Variable | Default | Accepts | Level | Description |
|---|---|---|---|---|
| `DATABASE_URL` | — (required) | a PostgreSQL URL | C1 | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/quizdock`. **Required** (provided by Compose; baked into `:standalone`). |
| `REDIS_URL` | — (provided by Compose) | a Redis URL | C1 | Redis connection string, e.g. `redis://host:6379`. Live-game state only. |
| `MEDIA_DIR` | `/data/media` (images) | a path | C1 | Where uploaded images, videos and sounds are stored. Mount a volume here to persist. |
| `STORE_DIR` | `/data/store` (images) | a path | C1 | Where the **catalogue of shared templates** lives: `index.json` plus one folder per template, in the bundle format. Its own volume, like `MEDIA_DIR` — **back it up with the database**, it is not in PostgreSQL. The sample quizzes are seeded here at start. |
| `SAMPLES_DIR` | `/app/samples` (images) | a path | C1 | Where the image keeps the **sample quizzes** it ships: one bundle folder each, with their media. At its first start an instance also adds those media to the **instance's media**, unless an administrator already curates that library; a `.samples-media` marker in `MEDIA_DIR` keeps them from coming back once removed. |

Back up `MEDIA_DIR` and `STORE_DIR` with the database: they are not in PostgreSQL.

### Limits

| Variable | Default | Accepts | Level | Description |
|---|---|---|---|---|
| `MEDIA_MAX_BYTES` | `10485760` | bytes, 1 to 50 MB | C2 | Max size of an uploaded **image**, in bytes. Default 10 MiB. |
| `MEDIA_MAX_VIDEO_MB` | `50` | 1 to 500 (MB) | C2 | Max size of an uploaded **video**, in MB. The editor converts to MP4 H.264 + AAC and compresses a long video to fit. |
| `MEDIA_MAX_AUDIO_MB` | `10` | 1 to 100 (MB) | C2 | Max size of an uploaded **sound**, in MB. The editor converts to M4A (AAC). |
| `IMPORT_MAX_BYTES` | `52428800` | bytes, 1 to 500 MB | C2 | Max size of an imported quiz bundle (zip), in bytes. Default 50 MiB. |
| `PUBLICATION_MAX_MB` | `20` | 1 to 100 (MB) | C3 | Largest bundle the editor's *Export for publication* allows, in MB: the limit of the community store, kept under GitHub's 25 MB web-upload limit. An organisation running its own store may set another. |
| `MEDIA_LIBRARY_LINKS` | _(seven free libraries)_ | a JSON list, or `none` | C4 | The free media libraries the editor links to: a JSON list of `{"name", "url", "kinds"}` (`kinds` among `image`, `video`, `audio`), or `none` to hide them (an instance without Internet). Default, open licences only and several per kind: OpenSoundLibrary, Freesound, ccMixter, Openverse, Wikimedia Commons, NASA Image and Video Library, Internet Archive. |

Formats, conversion and playback: [audio & video](audio-video.md). **Behind a reverse proxy, raise its
request body limit to the largest of these sizes** — nginx refuses anything over 1 MB by default
(`client_max_body_size 50m;`).

### Game pace

| Variable | Default | Accepts | Level | Description |
|---|---|---|---|---|
| `GAME_READ_DELAY_MS` | `3000` | 0 to 10000 (ms) | C3 | Reading window shown before a question's timer starts, in milliseconds. |
| `GAME_ALL_ANSWERED_DELAY_MS` | `1000` | 0 to 5000 (ms) | C3 | Once every participant has answered, how long the question stays before its answer is revealed, in milliseconds. |
| `GAME_AUTO_ADVANCE_MS` | `5000` | 1000 to 60000 (ms) | C3 | Automatic mode: time spent on a reveal or a content slide before moving on, unless the question or slide sets its own, in milliseconds. |
| `GAME_MEDIA_WAIT_S` | `10` | 0 to 60 (s) | C3 | How long the room waits at most, before a question, for the devices that play its sound or video to load it (the host can start anyway), in seconds. `0` never waits. |
| `LIVE_MOTION` | `on` | `on` · `off` | C4 | Transitions between steps on the projection and the phones, as a new room starts: the previous background fades out, the step comes in, the standings slide. `off` for old projectors or low-end devices. The host switches it for their room at any time (console, *Animations*); a device asking the system to reduce motion keeps fades only. |

### Administration

| Variable | Default | Accepts | Level | Description |
|---|---|---|---|---|
| `ADMIN_WEB_SCOPE` | `read` | `read` · `write` | C1 | What the web administration may change in the Instance domain (settings, accounts, host seat): `read` shows everything and changes nothing; `write` lets administrators change the C2–C4 settings and run the instance operations, each critical one confirmed. Media and quizzes are not concerned. |
| `ADMIN_LOCK` | — | comma-separated variable names | C1 | Variables the web administration may never change, whatever `ADMIN_WEB_SCOPE` says: comma-separated names (e.g. `APP_NAME,MEDIA_MAX_VIDEO_MB`). The CLI is not concerned. |
| `ADMIN_TOKEN` | — | text, 32 characters or more | C1 | Local mode (`AUTH_MODE=none`) has no accounts, so whoever reaches the instance could administer it: the web administration changes nothing there — the media library aside — unless this token is set, and asks for it before any change. At least 32 characters: a shorter one is ignored, as if unset. |
| `ADMIN_OVERRIDES` | `apply` | `apply` · `ignore` | C1 | `ignore` starts the instance on its environment alone: every value changed from the web administration is ignored (kept, not deleted) — the way back when one of them went wrong. |

What the web administration may do, and the audit: [administration](administration.md).

### Deployment (Compose)

Read by `docker-compose.prod.yml` and the `quizdock` script, never by the application.

| Variable | Default | Level | Description |
|---|---|---|---|
| `HTTP_PORT` | `18080` | C1 | Host port mapped to the app. |
| `QUIZDOCK_TAG` | `latest` | C1 | Image tag to run (`0.4.0` to pin). |
| `POSTGRES_USER` | `live` | C1 | Bundled PostgreSQL user (builds `DATABASE_URL`). |
| `POSTGRES_PASSWORD` | `live` | C1 | Its password. |
| `POSTGRES_DB` | `quizdock` | C1 | Its database. |
| `QUIZDOCK_MODE` | `compose` | C1 | What the `quizdock` script runs: `compose`, `standalone` or `full`. |

### Bundled Keycloak (full preset)

`quizdock init --full` fetches `docker-compose.full.yml`, used alongside the production
Compose file. Only this overlay derives the app and OIDC URLs from `PUBLIC_HOST`.
Other presets keep their existing defaults even when that variable is set.

| Variable | Default | Level | Description |
|---|---|---|---|
| `PUBLIC_HOST` | `localhost` | C1 | Full preset: browser-facing hostname or LAN IP for both services. |
| `PUBLIC_SCHEME` | `http` | C1 | Full preset: URL scheme; use `https` behind a TLS reverse proxy. |
| `KEYCLOAK_PORT` | `18081` (full), `18080` (dev) | C1 | Keycloak's published HTTP port. |
| `KEYCLOAK_PUBLIC_URL` | Scheme, host and Keycloak port | C1 | Full preset: override the browser-facing Keycloak URL, including a proxy path. |
| `KEYCLOAK_APP_URL` | Scheme, host and app port (full) | C1 | Override the app URL allowed for browser redirects. Dev also allows `localhost:15173`, and defaults to `localhost:18081`. |
| `KEYCLOAK_DEV_URL` | `http://localhost:15173` (dev) | C1 | Additional dev frontend redirect, alongside `KEYCLOAK_APP_URL`. The full preset uses only `KEYCLOAK_APP_URL`. |
| `KEYCLOAK_ADMIN` | `admin` | C1 | Keycloak bootstrap administrator. |
| `KEYCLOAK_ADMIN_PASSWORD` | Generated by `init --full` | C1 | Bootstrap administrator password; replace the manual example before first start. |
| `KEYCLOAK_HOST_PASSWORD` | Generated by `init --full` | C1 | Initial temporary full-preset host password; dev always uses `animateur`. |
| `KEYCLOAK_PLAYER_PASSWORD` | Generated by `init --full` | C1 | Initial temporary full-preset player password; dev always uses `participant`. |

Explicit `APP_PUBLIC_URL`, `OIDC_ISSUER` and `OIDC_INTERNAL_URL` override the full
preset's derived defaults. Realm import creates accounts only on a fresh database;
changing the initial passwords does not reset existing accounts.

<!-- END environment reference -->

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
- **Read-only template catalogue.** The sample templates (France, Taiwan, Türkiye) are seeded
  and can be previewed and copied — the way back to something playable when someone
  emptied the shared bank — but sharing and withdrawing are refused
  (`403 store.demo_disabled`) and their buttons are hidden.
- **No media uploads** (`403 media.demo_disabled`, also for imported bundles that carry
  media). The upload buttons are hidden.
- **Hourly reset** to a blank install: users, quizzes, media, session archives, the seat
  and the live state — then `demo_user` and its seat are created again, with the sample
  quizzes in its bank, ready to present. A reset waits while a session is being played,
  at most 3 hours.

The SPA shows a banner saying so, and the **home page lists these guards in full** —
someone trying QuizDock there must be able to tell a guard of that instance from a limit
of the product, so the list ends by saying that a self-hosted instance has none of them.
When the app runs from the `:standalone` image it adds that image's own limits to the
list (application, database and cache in one container); the image announces itself
through `QUIZDOCK_FLAVOR=standalone`, which it sets on its own — an operator never has to.
The templates are never touched by the reset: the catalogue is a folder, not a table.
