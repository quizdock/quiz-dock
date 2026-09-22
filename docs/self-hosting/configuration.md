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

How to replace the logo and the stylesheet: **[branding](branding.md)**.

### Access & instance mode

| Variable | Default | Description |
|---|---|---|
| `AUTH_MODE` | `none` | `none` = local mode (no IdP, single host seat); `oidc` = validate JWTs from any OpenID Connect provider. |
| `DEMO_MODE` | `false` | `true` = public demo guards: the host seat lasts 5 min (renewable), media uploads are refused, and everything is wiped every hour. See below. |
| `OIDC_ISSUER` | — | `iss` expected in tokens (your provider's issuer URL). Required when `AUTH_MODE=oidc`. |
| `OIDC_JWKS_URI` | _(discovery)_ | JWKS endpoint. Default: `jwks_uri` from `${OIDC_ISSUER}/.well-known/openid-configuration`. Set it to target an internal host in Docker. |
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
| `MEDIA_DIR` | `/data/media` | app | Where uploaded images/audio are stored. Mount a volume here to persist. |

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

### Limits & game pacing

| Variable | Default | Description |
|---|---|---|
| `MEDIA_MAX_BYTES` | `10485760` | Max upload size per file (bytes). Default 10 MiB. |
| `IMPORT_MAX_BYTES` | `52428800` | Max size of an imported quiz bundle (zip). Default 50 MiB. |
| `GAME_AUTO_ADVANCE_MS` | `5000` | Automatic mode: time spent on a reveal or a content slide before moving on, unless the question/slide sets its own. |
| `GAME_READ_DELAY_MS` | `3000` | Reading window shown before a question's timer starts. |

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
top, whatever the auth mode. `DEMO_MODE=true` is meant for `:standalone` with no volume,
where anyone can take the host seat, write quizzes and run sessions. The guards:

- **Host seat: 5 minutes at a time** (local mode only — OIDC has no seat). The expiry
  choice disappears from the sign-in dialog; the seat can be renewed for another
  5 minutes from the user menu while held. The server ignores any other duration.
- **No media uploads** (`403 media.demo_disabled`, also for imported bundles that carry
  media). The upload buttons are hidden.
- **Hourly reset** to a blank install: users, quizzes, media, session archives, the seat
  and the live state. A reset waits while a session is being played, at most 3 hours.

The SPA shows a banner saying so. The sample quizzes come back with the next seat claim,
as on any fresh install.
