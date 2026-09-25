# Technical debt

Known shortcuts and their way out, kept in step with the code. An entry says what is
there, why it is acceptable for now, what it costs, and what would replace it. Remove an
entry in the PR that pays it back.

## OIDC tokens at rest in Redis

- **Where**: `apps/backend/src/auth/oidc/oidc-sessions.ts`.
- **What**: the browser sessions keep their access, refresh and ID tokens in Redis, in
  clear; only the session id is hashed.
- **Why it is acceptable**: Redis is on the internal network of the compose files, never
  published, and already holds the live games; the tokens left the browser, which is
  where they were exposed.
- **Cost**: whoever reads Redis (a published port, a leaked dump) can act as the signed-in
  hosts until their refresh tokens expire.
- **Way out**: encrypt the session record with a key from the environment (AES-GCM),
  or keep the refresh token only, encrypted, and the access token in memory.

## The CSP's two loose points

- **Where**: `apps/backend/src/common/csp.ts`.
- **What**: `style-src 'unsafe-inline'` (style attributes and the style tags libraries
  insert) and `img-src https:` (an author's Markdown may show an image from the web).
- **Way out**: nonces for styles; a proxy or an allow-list for images.

## `user.locale`, a column nobody reads

- **Where**: `prisma/schema.prisma` (`User.locale`, default `fr`).
- **What**: the interface language is the instance's (`APP_LANG`), by decision; quizzes are
  monolingual. The column is a leftover, and its default is wrong on an English instance.
- **Way out**: drop it in a migration when one is due anyway.

## A test mock short of an export

- **Where**: `apps/frontend/src/routes/editor-page.test.tsx`.
- **What**: its mock of `../game/game-client` has no `ensureGameSocket`; a component under
  the editor calls it, and Vitest logs the error while the tests still pass.
- **Way out**: add the export to the mock (or mock the component that uses it).
