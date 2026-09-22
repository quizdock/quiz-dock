# Authentication — local mode & OIDC

> Part of the [self-hosting guides](README.md). The variables themselves are listed in
> [configuration → access & instance mode](configuration.md#access--instance-mode).

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
  matter: see [public demo instance](configuration.md#public-demo-instance).)

`GET /auth/host-seat` (public) reports the holder and expiry; `POST /auth/host-seat/claim`
and `POST /auth/host-seat/release` are what the SPA calls.

Set **`AUTH_MODE=oidc`** to require sign-in for hosts against **any OpenID Connect
provider**. QuizDock only relies on the OIDC standards — Discovery 1.0, the
Authorization Code flow with PKCE, JWKS-signed JWTs and the Core 1.0 claims — so any
compliant IdP works without product-specific glue. Players still join sessions by PIN
without an account.

## How it works

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

## Variables

```dotenv
AUTH_MODE=oidc
OIDC_ISSUER=https://idp.example.com/            # must equal the token `iss`
OIDC_CLIENT_ID=quizdock-frontend                # public SPA client id
OIDC_JWKS_URI=                                  # optional: skip discovery, use this JWKS
OIDC_AUDIENCE=                                  # optional: expected `aud`
OIDC_ROLES_CLAIM=roles                          # dotted path of the roles array claim
```

## Roles

QuizDock reads a roles array from the token. The **`host`** role grants host
privileges (create / edit / present quizzes) and is **enforced** on every host
API and WebSocket event; users without it can still join as players (`admin` is
treated as host). Providers expose roles under different claims: point
`OIDC_ROLES_CLAIM` at yours — a flat `roles` (default), `groups`, or a nested path
such as `realm_access.roles` or `resource_access.quizdock.roles`.

## Register the client on your IdP

QuizDock's frontend is a **public SPA client** (no client secret), using PKCE.
Configure on your IdP:

- **Client type**: public / SPA, **PKCE** enabled, standard (authorization code) flow.
- **Valid redirect URI**: `https://quiz.example.com/auth/callback`
- **Valid post-logout redirect URI** / **Web origin (CORS)**: `https://quiz.example.com`
- A **`host`** role (or group) assigned to the users who may run quizzes, exposed in
  the token under the claim you set in `OIDC_ROLES_CLAIM`.

## Docker networking caveat — issuer vs JWKS host

In Docker, the **browser** and the **backend** may reach the IdP at different hostnames.
`OIDC_ISSUER` must match the `iss` the browser sees (e.g. `http://localhost:18080/…`),
while discovery from inside the container would hit the same public host. If that host
is not reachable from the backend, set `OIDC_JWKS_URI` to the internal service URL
(e.g. `http://idp:8080/…/jwks`) — that's why it is a separate variable.

## Example IdP for development

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

## Troubleshooting

| Symptom (in backend logs) | Fix |
|---|---|
| `unexpected "iss" claim value` | `OIDC_ISSUER` ≠ the token's `iss`. Match it exactly (scheme/host/port/trailing slash). |
| `signature verification failed` | Wrong/unreachable JWKS: check `OIDC_JWKS_URI` or that the backend can reach `${OIDC_ISSUER}/.well-known/openid-configuration`. |
| `OIDC discovery failed` | The backend cannot reach the issuer host (Docker networking): set `OIDC_JWKS_URI` to the internal URL. |
| `403 auth.host_required` | The user is authenticated but has no `host` role in the claim `OIDC_ROLES_CLAIM` points at. |
| `unexpected "aud" claim value` | Token `aud` ≠ `OIDC_AUDIENCE`. Fix it or leave `OIDC_AUDIENCE` empty. |
| Redirect loop / `invalid redirect_uri` | Add `<origin>/auth/callback` to the IdP client's allowed redirect URIs. |
