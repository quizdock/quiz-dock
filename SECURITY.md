# Security policy

## Supported versions

QuizDock is `0.x`. Security fixes target the **latest** release only; please run a recent
tag of `fchaussin/quizdock` (and rebuild `:standalone` on a fresh base periodically).

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

- Preferred: open a [private security advisory](https://github.com/quizdock/quiz-dock/security/advisories/new)
  (GitHub → *Security* → *Report a vulnerability*).
- Alternatively, email the maintainer (see the commit author address).

Include a description, affected version/tag, reproduction steps and impact. We aim to
acknowledge within a few days. As a small open-source project there is no bounty, but
fixes are prioritized and disclosed once a patched release is available.

## How we keep dependencies and images clean

- **Per-push / per-PR / weekly scans** — see [`docs/security/`](docs/security/) and the
  [`Security` workflow](.github/workflows/security.yml): `pnpm audit` gates app CVEs; Trivy
  scans the filesystem and the published image (SARIF → Security tab).
- **Hardened runtime** — non-root, read-only root FS, dropped capabilities,
  `no-new-privileges`.
- **Point-in-time audits** are recorded under [`docs/security/`](docs/security/).
