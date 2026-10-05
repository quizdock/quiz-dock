# Contributing

Thanks for helping! A few things make a pull request easy to take in.

## Branches

- **Start from `dev` and open the pull request against `dev`.** `main` holds the
  last release; `dev` is where the next one is built. GitHub offers `main` by
  default: change the base before creating the pull request.
- One subject per pull request. For anything larger than a fix, say what you
  plan in the issue first: the design may already be decided in
  [`specifications/`](specifications/README.md).

## Before you push

- Setting up: [README › Development](README.md#development).
- `pnpm lint`, `pnpm typecheck` and `pnpm test` pass.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat(import): …`, `fix(game): …`); a git hook checks them.
- A changed API: regenerate the client with `pnpm generate:api` and commit it
  (`tools/generate-api/run.sh` does it in a container when the host cannot).
- A changed live screen: `tools/live-check/run.sh` plays a room for real on the demo
  stack (console, projection, a phone), checks it and keeps the pictures;
  `LIVE_CHECK_STACK=dev` runs it on the dev stack, through its identity provider when it
  is in OIDC.
- Code, comments, commits and documentation are in English; user-facing text
  goes through the translations, in every language of `apps/frontend/src/i18n/locales`.
