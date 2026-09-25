# Security

How QuizDock is scanned, hardened and audited.

## Continuous scanning

- [`.github/workflows/security.yml`](../../.github/workflows/security.yml) runs on every
  push to `main`, every PR and weekly:
  - **`deps`** — `pnpm audit` (high/critical **gate**) + Trivy filesystem scan.
  - **`image`** — Trivy scan of the published `:latest` and `:standalone` images
    (**reports** to the Security tab, non-blocking for unfixable base-OS CVEs).
- Findings land in the repository **Security → Code scanning** tab (SARIF).

## Point-in-time audits

| Date | Report |
|---|---|
| 2026-09-21 | [`cve-audit-2026-09-21.md`](cve-audit-2026-09-21.md) — `:latest` was the standalone image; Prisma 7.10 drops hono; non-root dev images |
| 2026-06-25 | [`cve-audit-2026-06-25.md`](cve-audit-2026-06-25.md) |

## Runtime hardening

The image runs **non-root** (uid 65532), **read-only** root filesystem, all Linux
capabilities dropped, `no-new-privileges`; media on a volume, `/tmp` on tmpfs. See
[`../self-hosting/configuration.md`](../self-hosting/configuration.md).

## Content-Security-Policy

Every page of the application is sent with a `Content-Security-Policy`
(`apps/backend/src/common/csp.ts`), built from the configuration: scripts and requests
from this origin only, no frames, plus a logo served elsewhere (`APP_LOGO_URL`). The
OIDC provider needs no exception: the backend talks to it, the browser only navigates
there. No
inline script and no `eval`; `'wasm-unsafe-eval'` and `blob:` workers for the in-browser
media converter; `object-src 'none'`, `frame-ancestors 'self'`. The API (`/api`, Swagger
included) and the socket are left out. What stays loose, and why, is in
[`../tech-debt.md`](../tech-debt.md).

## Sessions under OIDC

The backend is the OIDC client (Authorization Code + PKCE, `apps/backend/src/auth/oidc/`)
and keeps the tokens in Redis; the browser holds a random session id in an `httpOnly`,
`SameSite=Lax` cookie (`Secure` over HTTPS), so a script injected in a page has no token
to take away. Each sign-in gets a fresh id and Redis stores only its hash. The access
token is renewed there, one renewal at a time per session. Requests that change
something, and the game socket, are accepted with the cookie only from the application's
own pages (`Sec-Fetch-Site`, else `Origin` against the host). Which proxies may speak for
the client is `TRUST_PROXY`.

## Reporting a vulnerability

See [`SECURITY.md`](../../SECURITY.md) at the repository root.
