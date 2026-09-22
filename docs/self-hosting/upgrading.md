# Upgrading

> Part of the [self-hosting guides](README.md). The `quizdock` script automates it:
> see the [CLI guide](cli.md).

With the [CLI](cli.md): `./quizdock upgrade <tag>` does all of the below (backup,
pull, restart, migration check, doctor). By hand:

Migrations are part of the image and run **automatically** before the app starts:
the `migrate` one-shot service in `docker-compose.prod.yml`, or the entrypoint of the
`:standalone` image. Upgrading is therefore:

```bash
# 1. back up the database (compose: service `postgres`; standalone: inside the container)
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U live quizdock > quizdock-$(date +%F).sql
# 2. pull and restart on the new tag
QUIZDOCK_TAG=0.4.0 docker compose -f docker-compose.prod.yml pull
QUIZDOCK_TAG=0.4.0 docker compose -f docker-compose.prod.yml up -d
# 3. check the migration ran
docker compose -f docker-compose.prod.yml logs migrate
```

Rules:

- **Back up first.** Some migrations convert data (e.g. 0.4.0 turns slides into blocks), not just the schema.
- **No rollback.** Once a newer image's migrations ran, an older image will refuse to start on that database (and columns may be gone). To go back, restore the backup.
- **Read the release notes.** Every release lists its schema changes and anything to do by hand under *Upgrading* — if the section is absent, nothing is required.
- Media (`MEDIA_DIR`) and the shared templates (`STORE_DIR`) are untouched by upgrades; keep them on their volumes, and back them up with the database — neither lives in PostgreSQL.
