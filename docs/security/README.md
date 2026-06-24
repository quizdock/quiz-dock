# Security

How QuizDock is scanned, hardened and audited.

## Continuous scanning

- [`.github/workflows/security.yml`](../../.github/workflows/security.yml) runs on every
  push to `main`, every PR and weekly:
  - **`deps`** — `pnpm audit` (high/critical **gate**) + Trivy filesystem scan.
  - **`image`** — Trivy scan of the published image (**reports** to the Security tab,
    non-blocking for unfixable base-OS CVEs).
- Findings land in the repository **Security → Code scanning** tab (SARIF).

## Point-in-time audits

| Date | Report |
|---|---|
| 2026-06-25 | [`cve-audit-2026-06-25.md`](cve-audit-2026-06-25.md) |

## Runtime hardening

The image runs **non-root** (uid 65532), **read-only** root filesystem, all Linux
capabilities dropped, `no-new-privileges`; media on a volume, `/tmp` on tmpfs. See
[`../self-hosting/configuration.md`](../self-hosting/configuration.md).

## Reporting a vulnerability

See [`SECURITY.md`](../../SECURITY.md) at the repository root.
