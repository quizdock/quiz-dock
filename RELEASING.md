# Releasing QuizDock

How to publish the QuizDock images so anyone can self-host without building from
source. **Nothing here runs automatically yet** — this is the prepared plan, to
trigger when we decide to ship. Org `quizdock` is reserved on Docker Hub.

## Images

Two images, pushed under the `quizdock` Docker Hub namespace:

| Image | Built from | Runs |
|---|---|---|
| `quizdock/quiz-dock-backend` | `apps/backend/Dockerfile` (target `runtime`) | NestJS API + WebSocket |
| `quizdock/quiz-dock-frontend` | `apps/frontend/Dockerfile` (target `runtime`) | Nginx serving the SPA |

**Multi-arch**: build `linux/amd64` + `linux/arm64` (many self-hosters run ARM).

### Where (registry & namespace)

- **Docker Hub** — target namespace `quizdock` (`quizdock/quiz-dock-backend`,
  `quizdock/quiz-dock-frontend`). ⚠️ Docker Hub accounts are **separate from
  GitHub**: the `quizdock` namespace is still free and must be **created on
  hub.docker.com** (free org/account, browser action) before the first push.
- **GHCR (alternative, no extra account)** — `ghcr.io/quizdock/quiz-dock-backend`
  and `…-frontend`. Owned via the existing GitHub org `quizdock`, authenticated
  with `GITHUB_TOKEN`, free for public images. In the CI workflow below, swap the
  `images:` value and replace the Docker Hub login with
  `uses: docker/login-action@v3` against `ghcr.io` using `${{ github.actor }}` /
  `${{ secrets.GITHUB_TOKEN }}`.

## Versioning & tags

SemVer, pre-1.0 (`0.MINOR.PATCH`), driven by a git tag `vX.Y.Z`. Each release pushes:

- `:X.Y.Z` (immutable), `:X.Y`, and `:latest`.

## Prerequisites (one-time)

1. Create the two repos on Docker Hub under the `quizdock` org (or let the first push create them; set them public).
2. Create a Docker Hub **access token** (Account → Security) with read/write.
3. If using CI: add repo secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` to `quizdock/quiz-dock`.

## Option A — manual release (no CI)

```bash
VERSION=0.3.0
docker buildx create --use --name quizdock 2>/dev/null || docker buildx use quizdock
echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin

# Backend
docker buildx build --platform linux/amd64,linux/arm64 \
  -f apps/backend/Dockerfile --target runtime \
  -t quizdock/quiz-dock-backend:$VERSION -t quizdock/quiz-dock-backend:latest \
  --push .

# Frontend
docker buildx build --platform linux/amd64,linux/arm64 \
  -f apps/frontend/Dockerfile --target runtime \
  -t quizdock/quiz-dock-frontend:$VERSION -t quizdock/quiz-dock-frontend:latest \
  --push .
```

## Option B — GitHub Actions (opt-in, ready to enable)

Not added to `.github/workflows/` yet (CI was deliberately kept off). When ready,
drop the file below in and push a tag `vX.Y.Z`. Ask and I'll wire it.

```yaml
# .github/workflows/release.yml
name: Release images
on:
  push:
    tags: ['v*']
permissions:
  contents: read
jobs:
  publish:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
          - { name: backend, dockerfile: apps/backend/Dockerfile }
          - { name: frontend, dockerfile: apps/frontend/Dockerfile }
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
          images: quizdock/quiz-dock-${{ matrix.name }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: ${{ matrix.dockerfile }}
          target: runtime
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

## Consuming the published images (self-hosters)

Once published, a production `docker-compose.yml` can pull instead of build —
e.g. `image: quizdock/quiz-dock-backend:latest` / `…-frontend:latest`, keeping
the runtime hardening (`read_only`, `cap_drop`, `no-new-privileges`) and the
white-label env (`APP_NAME`, `APP_LANG`). A `docker-compose.prod.yml` example
will ship with the first published release.

## Checklist per release

- [ ] CHANGELOG updated, version bumped.
- [ ] Tag `vX.Y.Z` pushed.
- [ ] Images built multi-arch and pushed (`:X.Y.Z`, `:X.Y`, `:latest`).
- [ ] Docker Hub repos have a description + link to the GitHub repo.
- [ ] Landing page download/run instructions point at the published image.
