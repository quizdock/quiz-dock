# Self-hosting & integration

Guides for **running, configuring and integrating** QuizDock on your own
infrastructure — for operators and integrators (not contributors).

> Working **on** the code (architecture, contributing)? That's developer
> documentation: see [`../README.md`](../README.md), the
> [ADRs](../adr), and the [`specifications/`](../../specifications/README.md).

## Guides

- **[CLI — install, maintain, administer](cli.md)** — the `quizdock` script
  (init, up, backup/restore, upgrade) and the admin commands shipped in the
  image (doctor, host seat, users, quiz export / import, retention purge).
- **[Configuration](configuration.md)** — how to start it, every environment
  variable, ports and volumes, and the public-demo guards.
- **[Branding (white-label)](branding.md)** — name, language, logo and CSS,
  without rebuilding the image.
- **[Authentication](auth.md)** — the local host seat, or wiring your own OIDC
  identity provider.

## Run it

- **One container (easiest)** and **production (compose)** quick starts —
  see the main [README → Quick start](../../README.md#-quick-start-self-host).
- Published images on Docker Hub: [`fchaussin/quizdock`](https://hub.docker.com/r/fchaussin/quizdock)
  (`:latest` app image · `:standalone` all-in-one).

## Where participants connect (the invitation address)

Participants' phones open the address on the QR code / join link. The host
picks it in the console lobby (**Invitation address**); this table says what to
expect in each setup and what to configure so the right address is offered.

| Setup | What the console offers | Configure |
| --- | --- | --- |
| **Docker Desktop on a Mac or PC** (the usual local setup) | Nothing detected — the VM hides the computer's network; the console explains where to read the IP (System Settings / Settings › Network) | `HOST_LAN_IPS=<your IP>` in `.env`, or `-e HOST_LAN_IPS=<your IP>` on `docker run` — or just type it in the console |
| **Server with a domain** (reverse proxy, TLS) | The public address first | `APP_PUBLIC_URL=https://quiz.example.org` |
| **Linux server on the LAN**, no domain (compose or standalone) | The machine's LAN IPs, detected (`network_mode: host` or the standalone image see the host's interfaces) | nothing — or `HOST_LAN_IPS` to pin one |
| **Docker on Linux, bridge network** | Nothing detected (the container only sees `172.x`) | `HOST_LAN_IPS=192.168.1.20` |
| **Dev stack** (`docker compose up`, Vite on :15173) | As above, with the port of the page you are on | `HOST_LAN_IPS` in `.env` |
| **Console opened on `localhost`** | "This page" is useless for phones: the console opens the help by itself and pre-selects a LAN address when one is known | — |

Behind a reverse proxy nothing needs configuring: "this page" is the address the
browser resolved through the proxy (scheme and host included), and it is what
the console proposes. A remembered address or a LAN candidate is only applied
by itself when the console runs on `localhost`. In every case the host can
type any address (`Other address…`); it is kept on the session (console, projection and share link agree), frozen once the
session starts, and remembered by the browser for the next one. Phones must be
on the same network as the machine, and its firewall must let the port through.
Over HTTPS, an `http://` LAN address triggers a warning on phones: a public
address with a certificate is the clean way.

## Upgrading

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
- Media (`MEDIA_DIR`) is untouched by upgrades; keep it on its volume.
