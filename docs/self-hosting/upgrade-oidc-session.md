# Upgrade — OIDC session held by the backend

> `AUTH_MODE=oidc` only. Local mode (`none`), demo and `:standalone` without OIDC: nothing to do.
> Details: [authentication](auth.md). General procedure: [upgrading](upgrading.md).

## Variables

| Variable | Change | Action |
|---|---|---|
| `OIDC_SESSION_SCOPE` | **removed** (ignored, warning in the log) | Delete it. |
| `OIDC_INTERNAL_URL` | **new**, optional | Set it when the backend reaches the IdP at another address than the browser (Docker network). |
| `OIDC_CLIENT_SECRET` | **new**, optional | Set it if the IdP client is confidential. Public client + PKCE: leave it unset. |
| `TRUST_PROXY` | **new**, optional | Set it if the reverse proxy is not on a private address (`1`, or its address/CIDR). |
| `OIDC_JWKS_URI` | unchanged | On another host than the issuer: its host is used as `OIDC_INTERNAL_URL`. |
| `OIDC_CLIENT_ID` | now used by the backend | Nothing to do. |
| `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_ROLES_CLAIM`, `OIDC_NAME_CLAIM` | unchanged | — |

## Identity provider

| Item | Action |
|---|---|
| Redirect URI `https://<instance>/auth/callback` | Unchanged. |
| Post-logout redirect URI `https://<instance>` | Unchanged. |
| Web origins / CORS | No longer needed. |
| Refresh tokens | Must be issued (otherwise the session ends with the first access token). |
| Issuer seen from the backend | Must equal `OIDC_ISSUER`, even when reached at `OIDC_INTERNAL_URL`. Keycloak: `KC_HOSTNAME=<public URL>` + `KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true`. |
| Network | The backend must reach the token endpoint (not only the JWKS). |

## After the upgrade

- [ ] `./quizdock doctor` → `discovery ok → token endpoint …`, `JWKS reachable`.
- [ ] Sign in once (every user, once: the former sessions are not carried over).
- [ ] Open a second tab → still signed in.
- [ ] Log out → the IdP asks for credentials again.

## Behaviour changes

| Before | After |
|---|---|
| Tokens in the browser (`localStorage` / `sessionStorage`) | Tokens in Redis; the browser holds an `httpOnly` cookie. Old browser tokens are deleted at start-up. |
| Session kept after the browser is closed (`browser` scope) | Session ends with the browser; signing in again is usually one click (IdP session). |
| Header name from the ID token's `name` | Same name as the lobby: `OIDC_NAME_CLAIM`, then `preferred_username`, `name`, `email`. |
| IdP allowed in the CSP (`connect-src`, `frame-src`) | Removed: requests to this origin only, no frames. |
| A write from another origin of the same site went through | `403 auth.cross_origin`; a socket from another origin stays a guest. |

## Troubleshooting

| Log | Fix |
|---|---|
| `OIDC discovery failed` | Set `OIDC_INTERNAL_URL`. |
| `Sign-in failed: invalid_client` / `unauthorized_client` | Set `OIDC_CLIENT_SECRET`, or make the client public. |
| `Sign-in failed: … "iss" claim` | Fix the IdP's public hostname (Keycloak: `KC_HOSTNAME`). |
| Cookie without `Secure` behind HTTPS | Set `TRUST_PROXY`. |
