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
- Media (`MEDIA_DIR`) and the shared templates (`STORE_DIR`) live on their volumes, not in PostgreSQL: back them up with the database, **at the same moment**.
- **Media files renamed after 0.7.** From the release that stores each file once, the backend renames the existing media files after their SHA-256 on its first clean-up pass. Going back to an older release then means restoring the database **and** the media volume from the same backup: an older backend looks for the files under their former names. A database restored alone, older than the volume, is detected — the backend stops deleting stored files and says so in its log — but its media are not served until the volume matches.
- **The setup wizard, after 0.12.** A fresh instance offers a setup wizard in the browser, behind a setup token written in the logs at start ([administration](administration.md#6-the-setup-of-a-fresh-instance)). An instance already in use when it is upgraded is considered set up: nothing to do. An automated deployment of a fresh one skips it with `quizdock qd setup.complete`.
- **The pages and the API on one origin, after 0.12.** The API and the game's socket answer the application's own pages only — the pages served from the same origin, as every setup here does (nginx in the two-container setup, the standalone image). A setup of your own that serves the pages from another origin must put them behind the same one.
- **Configuration warnings at start, after 0.12.** The backend logs every variable it cannot read (it then uses the default, as before) or that falls outside the range [configuration](configuration.md#environment-reference) gives (it is still used as is), and `quizdock doctor` lists them. A critical one (level C1, e.g. `AUTH_MODE=OIDC`) is only a warning for now: **from v1, the instance will refuse to start** with it. Fix what the log names before then.
- **OIDC sign-in held by the backend, after 0.7.** `AUTH_MODE=oidc` only: see [upgrade — OIDC session held by the backend](upgrade-oidc-session.md).
- **Game sounds off in a new room, in 0.10.** The tick, the gong, the countdown and the ding start off in a room opened after the upgrade: the host turns on the ones they want from the console. No migration in 0.10.
- **Upgrade between two games, to 0.9.** The live state of a game moved into its room (several quizzes under one PIN): a game in progress during the upgrade is lost. Players simply join again.
- **`OIDC_ISSUER` taken as written, after 0.8.** `AUTH_MODE=oidc` only: earlier releases dropped a trailing slash from `OIDC_ISSUER`; it is now compared to the tokens' `iss` exactly, as the standard requires. If yours ends in `/` and your provider's issuer does not (or the reverse), sign-in fails with `unexpected "iss" claim value`: set it to the `issuer` of your provider's discovery document. The backend's log and `quizdock doctor` point out a difference of a trailing slash.
