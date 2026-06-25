# Releasing

The **only** manual gesture is creating a version tag. Everything else is automated by
[`.github/workflows/release.yml`](../.github/workflows/release.yml).

## Cut a release

```bash
git switch main && git pull
git tag -a v0.4.0 -m "v0.4.0"   # annotated; lightweight (git tag v0.4.0) also works
git push origin v0.4.0
```

That's it. The tag (`v*.*.*`) triggers, in one run:

1. **GitHub Release** — source of truth, created with auto notes, marked *latest*.
2. **`CHANGELOG.md`** — regenerated from conventional commits ([git-cliff](https://git-cliff.org),
   config in [`cliff.toml`](../cliff.toml)) and committed back to `main` (`[skip ci]`).
3. **Docker Hub images** — `:X.Y.Z`, `:X.Y`, `:latest`, plus `:standalone` / `:standalone-X.Y.Z`,
   multi-arch (amd64 + arm64). Docker Hub *follows* the GitHub release.

No version is maintained by hand: the tag is the version. `package.json` versions are not
used by the pipeline.

## Conventions that feed the changelog

Commit messages are [Conventional Commits](https://www.conventionalcommits.org) (already
enforced by commitlint). The type/scope drive the changelog grouping:

| Prefix | Section |
|---|---|
| `feat:` | Features |
| `fix:` | Bug Fixes |
| `fix(security…)` / `sec:` | Security |
| `perf:` | Performance |
| `refactor:` | Refactor |
| `docs:` | Documentation |
| `chore(deps…)` | Dependencies |
| `build:` | Build |
| `chore:` / `ci:` / `test:` / `style:` / `chore(release)` | omitted |

## Pre-release checklist (optional)

CI already gates every push, but before tagging you may run locally:

```bash
pnpm -r test && pnpm lint && pnpm typecheck
```
