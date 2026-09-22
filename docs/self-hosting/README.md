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
- **[Where participants connect](invitation-address.md)** — which address the
  QR code and the join link carry, per setup, and what to configure.
- **[Upgrading](upgrading.md)** — backup, pull, migrations, and the rules.

Images on Docker Hub: [`fchaussin/quizdock`](https://hub.docker.com/r/fchaussin/quizdock)
(`:latest` app image · `:standalone` all-in-one). Starting it: three commands in
[configuration → run it](configuration.md#run-it), in context in the
[README quick start](../../README.md#-quick-start-self-host).
