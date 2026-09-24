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
compliant IdP works without product-specific glue. Participants sign in too: see
[who may take part](#who-may-take-part) below.

A commented starting point: [`env/oidc.env.example`](../../env/oidc.env.example).

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
OIDC_NAME_CLAIM=                                # optional: dotted path of the display-name claim
```

## Who may host — assigning roles

An account holds a **set** of roles, and an empty set is a participant.
**`host`** covers its holder's own bank: create, edit and present quizzes.
**`admin`** is a **manager**: it reads the whole instance and administers it, and
on its own creates, edits and presents nothing, nor takes the host seat. The two
**cumulate**: `host,admin` is the usual account on a small instance — the whole
instance in read, plus a bank of one's own. A role is either **assigned** by the
operator, or **derived** from the context on every request:

| Mode | How someone becomes a host |
|---|---|
| `none` (local) | By **taking the host seat** — first come, first served, with the confirmation dialog. Only one at a time. |
| `oidc` | By carrying the **`host` role in their token**, under the claim `OIDC_ROLES_CLAIM` points at. No seat, no limit on how many. |
| either | By an **operator grant**: `user:set-role <sub\|email> host`. No seat, no claim needed. |

**Granting host privileges.** Promote the account once, from the host:

```bash
./quizdock user:list                                   # find the subject, e.g. local:alice
./quizdock user:set-role local:alice host              # admin to manage, host,admin for both
```

A grant is **sticky**: it outranks the seat and is never lowered — not by a seat
claim or its expiry in local mode, not by the IdP claims under OIDC. That account
keeps its privileges without ever claiming the seat, and other people can still
take the seat for themselves. `user:set-role … player` revokes the grant; the role
is then derived again on the next request. The user must have signed in at least
once to exist in the database (`user:list` shows them, with their grant).

If instead the seat is simply stuck — claimed with no expiry by someone who left:

```bash
./quizdock seat:status
./quizdock seat:release
```

Both commands are in the [CLI guide](cli.md).

## Roles in the token (OIDC)

QuizDock reads a roles array from the token. The **`host`** role grants host
privileges (create / edit / present quizzes) and is **enforced** on every host
API and WebSocket event; users without it can still join as players (`admin` is
treated as host). Providers expose roles under different claims: point
`OIDC_ROLES_CLAIM` at yours — a flat `roles` (default), `groups`, or a nested path
such as `realm_access.roles` or `resource_access.quizdock.roles`.

## Who may take part

Two independent barriers, and the second one never changes:

- the **token** grants access to the application (being authenticated, role `player`);
- the **PIN** grants access to one session, the one a host is running.

Under `AUTH_MODE=oidc` everyone therefore signs in, participants included: a valid
account opens no one else's session, and a PIN opens nothing without an account. The
join pages redirect to the sign-in page, which comes back to the invitation once the
IdP has answered, and `player:join` is refused without a valid token (`auth.required`).
Each participant's results are then attached to their account.

Under `AUTH_MODE=none` nothing changes: the PIN stays the only barrier, which is the
point of that mode.

### Open access (OIDC)

Some rooms have no accounts to give: trainees who change every session, visitors at
an event. Set **`ALLOW_ANONYMOUS_PARTICIPANTS=true`** and hosts keep signing in through
the IdP, but each launch then asks how participants get in, for the whole game:

- **Accounts required** (the default, as above);
- **Open access**: the PIN and a nickname are enough, as in local mode. Everyone is a
  guest, signed in or not, so there is no personal tracking and no name taken from an
  account.

A *Remember my choice* box skips the question from then on: the choice is kept with the
host's account and changed back under *My account → Preferences*. Until an
admin sets the variable, every game requires accounts and a client asking otherwise is
refused (`session.open_access_forbidden`).

Whatever the access, the host can **close the game to new participants**, from the
lobby or during the game (those already in come back after a lost connection) and remove one, and each
address may try 30 wrong PINs a minute — generous, since a whole room shares one
public address. Behind a reverse proxy on a private address, the client's address is
read from `X-Forwarded-For`. Published directly with no proxy in front, where Docker
hides the client's address (Docker Desktop, the userland proxy), every connection looks
private and that header could be forged: put a reverse proxy in front that sets it.

## The display name (OIDC)

What the lobby, the leaderboard and the podium show for an authenticated account
comes from the token: `preferred_username`, then `name`, then `email`. Point
`OIDC_NAME_CLAIM` at another claim — the standard `nickname`, or a nested path like
`profile.nickname` — to override that; the standard chain still answers for the
accounts whose token has no such claim.

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
Two accounts: `animateur` (host) and `participant` (no role), the password being the
username. In the repository's dev stack (with `docker-compose.override.yml`) it always
runs, and OIDC is one variable away; elsewhere, start it with the `keycloak` profile:

```bash
AUTH_MODE=oidc docker compose up -d backend                  # dev stack
AUTH_MODE=oidc docker compose --profile keycloak up -d       # base file alone
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
