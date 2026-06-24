<p align="center"><img src="https://quizdock.github.io/logo.svg" width="200" alt="QuizDock" /></p>

# QuizDock — open-source, self-hosted live quiz

Kahoot-style **live quiz you run yourself**. A host presents, players join from any
device with a **PIN or QR code** (no account, generated Multiavatar avatars), and
answers — weighted by speed and correctness — feed a live, **projector-ready**
leaderboard. One image, your servers, your data.

🌐 **Website:** https://quizdock.github.io · 🐙 **Source & docs:** https://github.com/quizdock/quiz-dock

## Supported tags

- `latest`, `0.3.0`, `0.3` — the app image (API + WebSocket + SPA). Needs **PostgreSQL** + **Redis** alongside.
- `standalone`, `standalone-0.3.0` — **all-in-one**: Postgres + Redis bundled, for one-command use.

All multi-arch: **linux/amd64**, **linux/arm64**.

## Quick start — one container (easiest)

Everything bundled — great for a demo or on Docker Desktop:

```bash
docker run -p 18080:3000 -v quizdock:/data fchaussin/quizdock:standalone
# then open http://localhost:18080
```

Data persists in the `quizdock` volume. For production, use the multi-service setup below.

## Quick start — production (app + your own DB)

```bash
docker pull fchaussin/quizdock:latest
curl -O https://raw.githubusercontent.com/quizdock/quiz-dock/main/docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d
# then open http://localhost:18080
```

Pin a version: `QUIZDOCK_TAG=0.3.0 docker compose -f docker-compose.prod.yml up -d`.

<details>
<summary>…or a minimal self-contained <code>compose.yml</code></summary>

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: live
      POSTGRES_PASSWORD: live
      POSTGRES_DB: quizdock
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7-alpine
  migrate:
    image: fchaussin/quizdock:latest
    command: ['node_modules/prisma/build/index.js', 'migrate', 'deploy']
    environment:
      DATABASE_URL: postgres://live:live@postgres:5432/quizdock
    depends_on: [postgres]
    restart: 'no'
  quizdock:
    image: fchaussin/quizdock:latest
    environment:
      DATABASE_URL: postgres://live:live@postgres:5432/quizdock
      REDIS_URL: redis://redis:6379
      APP_NAME: QuizDock
      APP_LANG: en
    ports: ['18080:3000']
    volumes: [mediadata:/data/media]
    depends_on:
      postgres: { condition: service_started }
      redis: { condition: service_started }
      migrate: { condition: service_completed_successfully }
volumes:
  pgdata:
  mediadata:
```

</details>

## Configuration

| Variable | Default | Description |
|---|---|---|
| `APP_NAME` | `QuizDock` | App name shown in the UI (white-label) |
| `APP_LANG` | `en` | UI language: `en` · `fr` · `es` · `zh` |
| `AUTH_MODE` | `none` | `none` (local / demo) or `oidc` (bring your own IdP) |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | — | Redis connection string |
| `MEDIA_DIR` | `/data/media` | Uploaded media — mount a volume to persist |
| `PORT` | `3000` | In-container HTTP port (map to your host) |

**White-label:** set `APP_NAME` / `APP_LANG`, and mount a `branding/` folder at
`/app/client/branding` (`logo.svg` + `override.css`) to rebrand without rebuilding.

## Security

Runs **non-root** (uid 65532), **read-only** root filesystem, all Linux capabilities
dropped, `no-new-privileges`. Media on a volume, `/tmp` on tmpfs.

## Links

- 📖 Source & docs — https://github.com/quizdock/quiz-dock
- 🌐 Website — https://quizdock.github.io
- 📄 License — MIT
