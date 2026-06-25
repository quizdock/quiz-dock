# Releasing QuizDock

QuizDock ships as **one image** — NestJS serves the API, the WebSocket and the
built SPA together. Postgres and Redis stay external (stateful). Migrations run
via a one-shot `migrate` service (same image). **Nothing here runs automatically
yet** — this is the prepared plan, to trigger when we decide to ship.

## The image

| Image | Built from | Contains |
|---|---|---|
| `fchaussin/quizdock` | root `Dockerfile` (target `runtime`, distroless non-root) | NestJS API + WebSocket + SPA + Prisma migrations |

**Multi-arch**: `linux/amd64` + `linux/arm64` (many self-hosters run ARM).

### Where (registry & namespace)

- **Docker Hub** — `fchaussin/quizdock` (account exists; one repo = one image).
  A Docker Hub **org `quizdock`** (still free) would match the brand better; the
  repo can be moved there later.
- **GHCR (alternative, no extra account)** — `ghcr.io/quizdock/quizdock`, owned
  via the GitHub org, authenticated with `GITHUB_TOKEN`.

## Versioning & tags

SemVer, pre-1.0 (`0.MINOR.PATCH`), driven by a git tag `vX.Y.Z`. Each release
pushes `:X.Y.Z` (immutable), `:X.Y`, and `:latest`.

## Prerequisites (one-time)

1. Docker Hub repo `fchaussin/quizdock` (or let the first push create it; public).
2. A Docker Hub **access token** (Account → Security, read/write).
3. If using CI: repo secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`.

## Option A — manual release (no CI)

```bash
VERSION=0.3.0
docker buildx create --use --name quizdock 2>/dev/null || docker buildx use quizdock
echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin
docker buildx build --platform linux/amd64,linux/arm64 \
  -t fchaussin/quizdock:$VERSION -t fchaussin/quizdock:latest \
  --push .
```

## Option B — GitHub Actions (opt-in, ready to enable)

Not added to `.github/workflows/` yet (CI deliberately kept off). When ready,
drop the file below in and push a tag `vX.Y.Z`.

```yaml
# .github/workflows/release.yml
name: Release image
on:
  push:
    tags: ['v*']
permissions:
  contents: read
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: fchaussin/quizdock
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest
      - uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

## Consuming the image (self-hosters)

`docker-compose.prod.yml` runs the stack: `quizdock` + `postgres` + `redis` +
a one-shot `migrate`. To pull instead of build, set `image: fchaussin/quizdock:latest`
on the `quizdock` and `migrate` services (drop their `build:`), then:

```bash
docker compose -f docker-compose.prod.yml up -d
# open http://localhost:18080   (APP_NAME / APP_LANG configurable in .env)
```

The image runs non-root with a read-only root FS, all caps dropped and
`no-new-privileges`; media on a volume, white-label via `APP_NAME`/`APP_LANG`
and the mounted `branding/` folder.

## Checklist per release

- [ ] CHANGELOG updated, version bumped.
- [ ] Tag `vX.Y.Z` pushed.
- [ ] Image built multi-arch and pushed (`:X.Y.Z`, `:X.Y`, `:latest`).
- [ ] README + landing page updated with `docker pull` instructions.

> The Docker Hub repo overview is synced automatically from `README.md` by the
> `dockerhub-readme` job in `release.yml` — no manual copy-paste.
