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
- **OIDC sign-in held by the backend, after 0.7.** From the release that moves the OIDC session to the backend, the browser keeps no token: everyone signs in once more after the upgrade, and the tokens an older version left in browsers are deleted. The client registered with your provider stays valid (same redirect URI); what changes is on the backend's side:
  - it now calls the provider's **token endpoint** itself. If it reached the provider by another address than the browser (an `OIDC_JWKS_URI` on an internal host), set `OIDC_INTERNAL_URL` to that address — an `OIDC_JWKS_URI` on another host is read that way already. The provider must then name itself with its public address on that internal one too (Keycloak: `KC_HOSTNAME` and `KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true`);
  - a **confidential** client needs its secret in `OIDC_CLIENT_SECRET`; a public one needs nothing;
  - `OIDC_SESSION_SCOPE` is gone (the tabs share one session); remove it;
  - behind a reverse proxy that is not on a private address, name it in `TRUST_PROXY` (new) so the session cookie is marked `Secure`.
