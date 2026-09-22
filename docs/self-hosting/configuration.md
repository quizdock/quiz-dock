# Configuration, branding & OIDC

Operator guide for self-hosting QuizDock: every environment variable, how to
white-label the app, and how to wire your own OIDC identity provider.

- [1. Configuration](#1-configuration)
- [2. Branding (white-label)](#2-branding-white-label)
- [3. OIDC authentication](#3-oidc-authentication)

---

## 1. Configuration

QuizDock is configured entirely through **environment variables** — no rebuild
needed. Where you set them depends on how you run it:

| Run mode | Where to set variables |
|---|---|
| `docker run` (e.g. `:standalone`) | `-e APP_LANG=fr` flags, or `--env-file .env` |
| `docker compose` (prod) | a `.env` file next to `docker-compose.prod.yml`, or the `environment:` block |
| Docker Desktop GUI | the container's **Environment variables** panel |

### Environment reference

| Variable | Default | Applies to | Description |
|---|---|---|---|
| `APP_NAME` | `QuizDock` | app | Brand name shown in the header, tab title and share text. |
| `APP_LANG` | `en` | app | UI language for the instance: `en` · `fr` · `es` · `zh` · `zh-TW`. One per deployment (no browser detection). |
| `APP_LOGO_URL` | — | app | Logo served from somewhere else (a CDN, a path outside `branding/`). Empty by default, which is the usual setup: the logo is then looked up in the mounted `branding/` folder. See §2. |
| `AUTH_MODE` | `none` | app | `none` = local mode (no IdP, single host seat); `oidc` = validate JWTs from any OpenID Connect provider. See §3. |
| `DEMO_MODE` | `false` | app | `true` = public demo guards: the host seat lasts 5 min (renewable), media uploads are refused, and everything is wiped every hour. See §4. |
| `PORT` | `3000` | app | In-container HTTP port. Map it to a host port (`-p 18080:3000`). |
| `DATABASE_URL` | — | app, migrate | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/quizdock`. **Required** (provided by compose; baked into `:standalone`). |
| `REDIS_URL` | — | app | Redis connection string, e.g. `redis://host:6379`. Live-game state only. |
| `MEDIA_DIR` | `/data/media` | app | Where uploaded images/audio are stored. Mount a volume here to persist. |
| `MEDIA_MAX_BYTES` | `10485760` | app | Max upload size per file (bytes). Default 10 MiB. |
| `APP_PUBLIC_URL` | — | app | Public address of the instance (`https://quiz.example.org`). Offered first as the invitation address (QR code, join link) on the host console. |
| `HOST_LAN_IPS` | — | app | Comma-separated LAN IPs of the machine (bare IPs), for setups where the container cannot see the host's interfaces (Docker Desktop, bridge network). Offered as invitation addresses with the scheme and port of the page. See [where participants connect](README.md#where-participants-connect-the-invitation-address). |
| `IMPORT_MAX_BYTES` | `52428800` | app | Max size of an imported quiz bundle (zip). Default 50 MiB. |
| `GAME_AUTO_ADVANCE_MS` | `5000` | app | Automatic mode: time spent on a reveal or a content slide before moving on, unless the question/slide sets its own. |
| `GAME_READ_DELAY_MS` | `3000` | app | Reading window shown before a question's timer starts. |
| `OIDC_ISSUER` | — | app | `iss` expected in tokens (your provider's issuer URL). Required when `AUTH_MODE=oidc`. |
| `OIDC_JWKS_URI` | _(discovery)_ | app | JWKS endpoint. Default: `jwks_uri` from `${OIDC_ISSUER}/.well-known/openid-configuration`. Set it to target an internal host in Docker (see §3). |
| `OIDC_CLIENT_ID` | `quiz-dock-frontend` | app | Public SPA client id (sent to the browser via `GET /auth/config`). |
| `OIDC_AUDIENCE` | _(unset)_ | app | Expected `aud`. Left unset = audience check skipped. |
| `OIDC_ROLES_CLAIM` | `roles` | app | Dotted path to the roles array in the JWT (e.g. `groups`, `realm_access.roles`). |

The multi-service `docker-compose.prod.yml` also exposes:

| Variable | Default | Description |
|---|---|---|
| `HTTP_PORT` | `18080` | Host port mapped to the app. |
| `QUIZDOCK_TAG` | `latest` | Image tag to run (`0.4.0` to pin). |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `live` / `live` / `quizdock` | Bundled Postgres credentials (used to build `DATABASE_URL`). |

### Ports & volumes

- The app listens on **`3000`** inside the container — publish it where you like (`-p 18080:3000`).
- **Media** persists under `MEDIA_DIR` (`/data/media`) — keep it on a volume.
- The **`:standalone`** image keeps PostgreSQL data under `/data/postgres`; mount a
  **named volume** at `/data` (`-v quizdock:/data`) so the database survives restarts.

---

## 2. Branding (white-label)

Three things are brandable **at runtime**, without rebuilding the image:

| What | How |
|---|---|
| **Name** | `APP_NAME` (header, tab, share messages). |
| **Language** | `APP_LANG` (`en`/`fr`/`es`/`zh`/`zh-TW`). |
| **Logo & CSS** | files served at fixed paths — replace them via a mounted folder, or point `APP_LOGO_URL` at a logo hosted elsewhere. |

### How it works

At startup the container serves a tiny `/config.js` generated from `APP_NAME`/`APP_LANG`,
which the SPA reads (`window.__APP_CONFIG__`). Two asset files are served at fixed paths:

- `/branding/logo.<ext>` — the header logo, in any web image format. The page tries
  `logo.svg`, `logo.avif`, `logo.webp`, `logo.png`, `logo.jpg`, `logo.jpeg`, `logo.gif`
  in that order and keeps the first file that loads, so drop **one** logo file with the
  extension you have (no conversion to SVG needed). If none is there, the logo bundled
  in the image is used — the header is never left empty. Setting `APP_LOGO_URL` skips
  this lookup entirely and loads that URL instead.
- `/branding/override.css` — an extra stylesheet loaded last, so you can override any
  CSS variable or rule. It is **optional**: when the mounted folder has no `override.css`,
  the server answers an empty `204` and nothing is overridden. The bundled default is
  intentionally near-empty.

### Override logo & CSS

Put your own logo (`logo.png`, `logo.svg`, …) and, if you want one, an `override.css`
in a folder, and mount it over the served `branding/` directory. In the single image it
lives at **`/app/client/branding`**:

```bash
docker run -p 18080:3000 \
  -v quizdock:/data \
  -v "$PWD/branding:/app/client/branding:ro" \
  -e APP_NAME="Acme Quiz" -e APP_LANG=fr \
  fchaussin/quizdock:standalone
```

With `docker-compose.prod.yml`, uncomment the branding volume line:

```yaml
    volumes:
      - mediadata:/data/media
      - ./branding:/app/client/branding:ro   # ← your logo.<ext> (+ override.css)
```

Example `branding/override.css` (recolor the primary):

```css
:root {
  --primary: oklch(0.6 0.2 20); /* QuizDock uses oklch design tokens */
}
```

> The mount replaces the whole folder, bundled defaults included, and both files are
> optional: with no `logo.*` in it the header falls back to the QuizDock logo, and with
> no `override.css` nothing is overridden. Keep only one `logo.*` file — a leftover
> `logo.svg` wins over your `logo.png`.

> **Logo size.** It is rendered 28 px high with a free width, so any ratio works, but
> keep it between 1:1 and ~3:1 — at 4:1 the header navigation wraps on a 360 px-wide
> phone. SVG, or a raster at least 56 px high with a transparent background.

---

## 3. OIDC authentication

By default (`AUTH_MODE=none`) QuizDock runs in **local mode**: no identity provider,
hosts identify with a name, and there is a single **host seat**:

- The seat is taken **intentionally**: on the sign-in page the app explains the lock
  and asks for confirmation, with an optional **auto-expiry** (1 h, 4 h, 24 h or none).
- While held, the host area is locked: everyone else can only join sessions as a
  participant (`403 auth.host_required` on the host API and `host:*` events).
- It is released when the holder logs out, or automatically once the expiry is past
  (checked lazily, no scheduler). The first claim also loads the two sample quizzes.
- A name is the only key: entering the holder's name again (on any device) resumes
  the seat — handy across devices, and the reason this is *not* a security boundary.
  Use it on trusted networks; use OIDC otherwise. (A public instance is a different
  matter: see §4, `DEMO_MODE`.)

`GET /auth/host-seat` (public) reports the holder and expiry; `POST /auth/host-seat/claim`
and `POST /auth/host-seat/release` are what the SPA calls.

Set **`AUTH_MODE=oidc`** to require sign-in for hosts against **any OpenID Connect
provider**. QuizDock only relies on the OIDC standards — Discovery 1.0, the
Authorization Code flow with PKCE, JWKS-signed JWTs and the Core 1.0 claims — so any
compliant IdP works without product-specific glue. Players still join sessions by PIN
without an account.

### How it works

1. The SPA calls `GET /auth/config` → `{ mode: "oidc", oidc: { authority, clientId } }`.
2. It runs the **Authorization Code + PKCE** flow (`oidc-client-ts`): discovery on
   `authority`, redirect to your IdP, back to **`<your-origin>/auth/callback`**, code
   exchanged for tokens. Tokens are renewed silently before they expire.
3. Every API/WebSocket call carries `Authorization: Bearer <access_token>`.
4. The backend verifies the JWT **signature** against the provider's **JWKS** (found
   through `${OIDC_ISSUER}/.well-known/openid-configuration`, or `OIDC_JWKS_URI`),
   **`iss`**, **`exp`** (and **`aud`** if `OIDC_AUDIENCE` is set), then reads roles
   from `OIDC_ROLES_CLAIM`.
5. Log out is **RP-initiated**: the SPA redirects to the provider's `end_session_endpoint`
   (falls back to a local sign-out when the provider has none).

Claims used: `sub` (identity key), `preferred_username` / `name` / `email` (display),
and the roles claim. The SPA requests scope `openid profile email`; `redirect_uri` is
`<origin>/auth/callback` and post-logout returns to `<origin>`.

### Variables

```dotenv
AUTH_MODE=oidc
OIDC_ISSUER=https://idp.example.com/            # must equal the token `iss`
OIDC_CLIENT_ID=quizdock-frontend                # public SPA client id
OIDC_JWKS_URI=                                  # optional: skip discovery, use this JWKS
OIDC_AUDIENCE=                                  # optional: expected `aud`
OIDC_ROLES_CLAIM=roles                          # dotted path of the roles array claim
```

### Roles

QuizDock reads a roles array from the token. The **`host`** role grants host
privileges (create / edit / present quizzes) and is **enforced** on every host
API and WebSocket event; users without it can still join as players (`admin` is
treated as host). Providers expose roles under different claims: point
`OIDC_ROLES_CLAIM` at yours — a flat `roles` (default), `groups`, or a nested path
such as `realm_access.roles` or `resource_access.quizdock.roles`.

### Register the client on your IdP

QuizDock's frontend is a **public SPA client** (no client secret), using PKCE.
Configure on your IdP:

- **Client type**: public / SPA, **PKCE** enabled, standard (authorization code) flow.
- **Valid redirect URI**: `https://quiz.example.com/auth/callback`
- **Valid post-logout redirect URI** / **Web origin (CORS)**: `https://quiz.example.com`
- A **`host`** role (or group) assigned to the users who may run quizzes, exposed in
  the token under the claim you set in `OIDC_ROLES_CLAIM`.

### Docker networking caveat — issuer vs JWKS host

In Docker, the **browser** and the **backend** may reach the IdP at different hostnames.
`OIDC_ISSUER` must match the `iss` the browser sees (e.g. `http://localhost:18080/…`),
while discovery from inside the container would hit the same public host. If that host
is not reachable from the backend, set `OIDC_JWKS_URI` to the internal service URL
(e.g. `http://idp:8080/…/jwks`) — that's why it is a separate variable.

### Example IdP for development

The repository ships one worked example so you can try OIDC locally: a Keycloak
realm in [`keycloak/realm-export.json`](../../keycloak/realm-export.json) (realm
`quiz-dock`, public client `quiz-dock-frontend`, roles `host`/`player`, exposed under
`realm_access.roles`). It is only an example — nothing in QuizDock depends on it.
Start it with the `keycloak` compose profile:

```bash
AUTH_MODE=oidc docker compose --profile keycloak up -d
```

The dev compose file then defaults `OIDC_ISSUER` to `http://localhost:18080/realms/quiz-dock`,
`OIDC_JWKS_URI` to the internal service and `OIDC_ROLES_CLAIM` to `realm_access.roles`.

### Troubleshooting

| Symptom (in backend logs) | Fix |
|---|---|
| `unexpected "iss" claim value` | `OIDC_ISSUER` ≠ the token's `iss`. Match it exactly (scheme/host/port/trailing slash). |
| `signature verification failed` | Wrong/unreachable JWKS: check `OIDC_JWKS_URI` or that the backend can reach `${OIDC_ISSUER}/.well-known/openid-configuration`. |
| `OIDC discovery failed` | The backend cannot reach the issuer host (Docker networking): set `OIDC_JWKS_URI` to the internal URL. |
| `403 auth.host_required` | The user is authenticated but has no `host` role in the claim `OIDC_ROLES_CLAIM` points at. |
| `unexpected "aud" claim value` | Token `aud` ≠ `OIDC_AUDIENCE`. Fix it or leave `OIDC_AUDIENCE` empty. |
| Redirect loop / `invalid redirect_uri` | Add `<origin>/auth/callback` to the IdP client's allowed redirect URIs. |

---

## 4. Public demo instance

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
