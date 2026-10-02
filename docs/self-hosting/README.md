# Self-hosting & integration

Guides for **running, configuring and integrating** QuizDock on your own
infrastructure — for operators and integrators (not contributors).

> Working **on** the code (architecture, contributing)? That's developer
> documentation: see [`../README.md`](../README.md), the
> [ADRs](../adr), and the [`specifications/`](../../specifications/README.md).

## Guides

- **[Choose a setup](setups.md)** — compare standalone, local Compose, your own
  OIDC provider and Compose with bundled Keycloak.
- **[CLI — install, maintain, administer](cli.md)** — the `quizdock` script
  (init, up, backup/restore, upgrade) and the admin commands shipped in the
  image (doctor, host seat, users, quiz export / import, retention purge).
- **[Administration](administration.md)** — the web administration and what the
  operator lets it change (`ADMIN_WEB_SCOPE`, `ADMIN_LOCK`, `ADMIN_TOKEN`), the
  audit of every administrative action.
- **[Configuration](configuration.md)** — how to start it, every environment
  variable, ports and volumes, and the public-demo guards.
- **[Sizing the VM](sizing.md)** — how many players at once for how many vCPU
  and how much RAM, as measured.
- **[Branding (white-label)](branding.md)** — name, language, logo and CSS,
  without rebuilding the image.
- **[Authentication](auth.md)** — the local host seat, or wiring your own OIDC
  identity provider.
- **[Audio & video](audio-video.md)** 🧪 *experimental* — accepted formats and
  how to convert, sizes and the reverse proxy, loudness levelling, timing,
  remote participants and who hears the sound, what is fetched ahead, the wait
  for media, and sound on the projection (including skipping the unlock click
  on a dedicated computer).
- **[Where participants connect](invitation-address.md)** — which address the
  QR code and the join link carry, per setup, and what to configure.
- **[Bringing a quiz from another tool](import-from-other-tools.md)** — a
  chatbot prompt that turns a PDF, screenshots, a spreadsheet or text (a Kahoot
  quiz, for one) into a file QuizDock imports.
- **[Upgrading](upgrading.md)** — backup, pull, migrations, and the rules.

Images on Docker Hub: [`fchaussin/quizdock`](https://hub.docker.com/r/fchaussin/quizdock)
(`:latest` app image · `:standalone` all-in-one). Starting it: three commands in
[configuration → run it](configuration.md#run-it), in context in the
[README quick start](../../README.md#-quick-start-self-host).
