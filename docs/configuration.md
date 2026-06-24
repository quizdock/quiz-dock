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
| `APP_LANG` | `en` | app | UI language for the instance: `en` · `fr` · `es` · `zh`. One per deployment (no browser detection). |
| `AUTH_MODE` | `none` | app | `none` = local/guest mode (no IdP); `oidc` = validate JWTs from your IdP. See §3. |
| `PORT` | `3000` | app | In-container HTTP port. Map it to a host port (`-p 18080:3000`). |
| `DATABASE_URL` | — | app, migrate | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/quizdock`. **Required** (provided by compose; baked into `:standalone`). |
| `REDIS_URL` | — | app | Redis connection string, e.g. `redis://host:6379`. Live-game state only. |
| `MEDIA_DIR` | `/data/media` | app | Where uploaded images/audio are stored. Mount a volume here to persist. |
| `MEDIA_MAX_BYTES` | `10485760` | app | Max upload size per file (bytes). Default 10 MiB. |
| `OIDC_ISSUER` | — | app | `iss` expected in tokens (your IdP realm URL). Required when `AUTH_MODE=oidc`. |
| `OIDC_JWKS_URI` | `${issuer}/protocol/openid-connect/certs` | app | JWKS endpoint. May target an internal host in Docker (see §3). |
| `OIDC_CLIENT_ID` | `quiz-dock-frontend` | app | Public SPA client id (sent to the browser via `GET /auth/config`). |
| `OIDC_AUDIENCE` | _(unset)_ | app | Expected `aud`. Left unset = audience check skipped. |
| `OIDC_ROLES_CLAIM` | `realm_access.roles` | app | Dotted path to the roles array in the JWT. Use `roles` for a flat claim. |

The multi-service `docker-compose.prod.yml` also exposes:

| Variable | Default | Description |
|---|---|---|
| `HTTP_PORT` | `18080` | Host port mapped to the app. |
| `QUIZDOCK_TAG` | `latest` | Image tag to run (`0.3.0` to pin). |
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
| **Language** | `APP_LANG` (`en`/`fr`/`es`/`zh`). |
| **Logo & CSS** | files served at fixed paths — replace them via a mounted folder. |

### How it works

At startup the container serves a tiny `/config.js` generated from `APP_NAME`/`APP_LANG`,
which the SPA reads (`window.__APP_CONFIG__`). Two asset files are served at fixed paths:

- `/branding/logo.svg` — the header logo (`<img>`).
- `/branding/override.css` — an extra stylesheet loaded last, so you can override any
  CSS variable or rule. The bundled default is intentionally near-empty.

### Override logo & CSS

Put your own `logo.svg` and `override.css` in a folder and mount it over the served
`branding/` directory. In the single image it lives at **`/app/client/branding`**:

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
      - ./branding:/app/client/branding:ro   # ← your logo.svg + override.css
```

Example `branding/override.css` (recolor the primary):

```css
:root {
  --primary: oklch(0.6 0.2 20); /* QuizDock uses oklch design tokens */
}
```

> Keep both files present in the mounted folder — an empty mount hides the bundled
> defaults (you'd lose the logo). Logo is a square SVG; ~1:1 works best in the header.

---

## 3. OIDC authentication

By default (`AUTH_MODE=none`) anyone can host or join with just a name — ideal for a
trusted/internal network or a demo. Set **`AUTH_MODE=oidc`** to require sign-in for
hosts against **any** OpenID Connect provider (Keycloak, Auth0, Entra ID, Authentik,
Zitadel, Google…). Players still join sessions by PIN without an account.

### How it works

1. The SPA calls `GET /auth/config` → `{ mode: "oidc", oidc: { authority, clientId } }`.
2. It runs the **Authorization Code + PKCE** flow (`oidc-client-ts`): redirect to your
   IdP, back to **`<your-origin>/auth/callback`**, exchange code for tokens.
3. Every API/WebSocket call carries `Authorization: Bearer <access_token>`.
4. The backend verifies the JWT **signature (JWKS)**, **`iss`**, **`exp`** (and **`aud`**
   if `OIDC_AUDIENCE` is set), then reads roles from `OIDC_ROLES_CLAIM`.

The SPA requests scope `openid profile email`; `redirect_uri` is
`<origin>/auth/callback` and post-logout returns to `<origin>`.

### Variables

```dotenv
AUTH_MODE=oidc
OIDC_ISSUER=https://idp.example.com/realms/quizdock      # must equal the token `iss`
OIDC_JWKS_URI=https://idp.example.com/realms/quizdock/protocol/openid-connect/certs
OIDC_CLIENT_ID=quizdock-frontend                          # public SPA client
OIDC_AUDIENCE=                                            # optional, expected `aud`
OIDC_ROLES_CLAIM=realm_access.roles                       # Keycloak default; use `roles` if flat
```

### Roles

QuizDock reads a roles array from the token. The **`host`** role grants host
privileges (create / edit / present quizzes); users without it can still join as
players. If your IdP exposes roles elsewhere, point `OIDC_ROLES_CLAIM` at it
(e.g. `roles`, `resource_access.quizdock.roles`).

### Register the client on your IdP

QuizDock's frontend is a **public SPA client** (no client secret), using PKCE.
Configure on your IdP:

- **Client type**: public / SPA, **PKCE** enabled, standard (authorization code) flow.
- **Valid redirect URI**: `https://quiz.example.com/auth/callback`
- **Valid post-logout redirect URI** / **Web origin (CORS)**: `https://quiz.example.com`
- A **`host`** role, assigned to the users who may run quizzes.

### Keycloak reference (dev)

A ready realm ships in [`keycloak/realm-export.json`](../keycloak/realm-export.json)
(realm `quiz-dock`, client `quiz-dock-frontend`, roles `host`/`player`). Start it with
the `keycloak` compose profile:

```bash
AUTH_MODE=oidc docker compose --profile keycloak up -d
```

### Docker networking caveat — issuer vs JWKS host

In Docker, the **browser** and the **backend** may reach the IdP at different hostnames.
`OIDC_ISSUER` must match the `iss` the browser sees (e.g. `http://localhost:48080/realms/…`),
while `OIDC_JWKS_URI` can point at the internal service name
(`http://keycloak:8080/realms/…/certs`). That's why they're separate variables.

### Troubleshooting

| Symptom (in backend logs) | Fix |
|---|---|
| `unexpected "iss" claim value` | `OIDC_ISSUER` ≠ the token's `iss`. Match it exactly (scheme/host/port/trailing slash). |
| `signature verification failed` | Wrong/unreachable `OIDC_JWKS_URI`. |
| `unexpected "aud" claim value` | Token `aud` ≠ `OIDC_AUDIENCE`. Fix it or leave `OIDC_AUDIENCE` empty. |
| Redirect loop / `invalid redirect_uri` | Add `<origin>/auth/callback` to the IdP client's allowed redirect URIs. |
