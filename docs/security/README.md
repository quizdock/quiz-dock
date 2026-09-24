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
(`apps/backend/src/common/csp.ts`), built from the configuration: scripts, frames and
requests from this origin only, plus the OIDC provider when `AUTH_MODE=oidc` (its
endpoints and the silent-renew iframe) and a logo served elsewhere (`APP_LOGO_URL`). No
inline script and no `eval`; `'wasm-unsafe-eval'` and `blob:` workers for the in-browser
media converter; `object-src 'none'`, `frame-ancestors 'self'`. The API (`/api`, Swagger
included) and the socket are left out. What stays loose, and why, is in
[`../tech-debt.md`](../tech-debt.md).

## Reporting a vulnerability

See [`SECURITY.md`](../../SECURITY.md) at the repository root.
