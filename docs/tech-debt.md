# Technical debt

Known shortcuts and their way out, kept in step with the code. An entry says what is
there, why it is acceptable for now, what it costs, and what would replace it. Remove an
entry in the PR that pays it back.

## OIDC tokens in the browser's storage

- **Where**: `apps/frontend/src/auth/oidc.ts` (`userStore`), `OIDC_SESSION_SCOPE`.
- **What**: the SPA is a public OIDC client; `oidc-client-ts` keeps the user (access, ID
  and refresh tokens) in Web Storage. With `OIDC_SESSION_SCOPE=browser` (the default) that
  is `localStorage`, shared by the tabs, so a preview or a console opened in a new tab stays
  signed in; with `tab`, `sessionStorage`, each tab signing in on its own.
- **Why it is debt**: any script running in the page can read Web Storage, so a single
  XSS hands over the tokens; `localStorage` also outlives the tab and the browser, so a
  token left on a shared computer stays usable until it expires. The IETF's *OAuth 2.0 for
  Browser-Based Apps* advises against keeping tokens there.
- **Why the default stays `browser`**: a host works across tabs — the console, the
  projection, a preview, the editor. Signed in per tab, every one of them asks again, and
  the experience suffers; `tab` stays available for shared computers.
- **Mitigations in place**: access tokens renewed silently (their lifetime is the IdP's); Markdown
  rendered as React elements with raw HTML dropped (`skipHtml`) and unsafe URLs
  neutralised; a sign-out in one tab signs the others out.
- **Content-Security-Policy**: every page carries one (no inline script, no `eval`,
  requests limited to this origin and the IdP), the first line of defence against the XSS
  this storage is exposed to. It stays loose on two points: `style-src 'unsafe-inline'`
  (style attributes and the style tags libraries insert) and `img-src https:` (an author's
  Markdown may show an image from the web). Tightening them means nonces for styles and a
  proxy or an allow-list for images.
- **Way out**, by increasing effort:
  1. **Tokens per tab, session from the IdP**: back to `sessionStorage` (or memory), and a
     tab without a session asks the IdP silently (`signinSilent`, `prompt=none`) — the
     IdP's own session cookie supplies fresh tokens, nothing persists in the SPA. Limit: a
     silent iframe needs third-party cookies when the IdP is on another site (Safari,
     Firefox strict mode); the tab then falls back to the sign-in page, one click away.
  2. **Backend for Frontend (BFF)**: the backend runs the Authorization Code flow as a
     confidential client, keeps the tokens server-side and gives the browser an `httpOnly`,
     `SameSite` session cookie; the WebSocket handshake reads that cookie. No token ever
     reaches JavaScript. Touches the auth provider, the WS handshake, CSRF protection and
     logout — a design change of its own.

## The client address behind a proxy

- **Where**: `apps/backend/src/game/pin-attempts.ts` (`clientIp`), used by the wrong-PIN
  limit.
- **What**: `X-Forwarded-For` is believed when the connecting peer is a private address,
  taken as our reverse proxy; there is no explicit list of trusted proxies.
- **Cost**: published without a proxy where Docker hides the client address (Docker
  Desktop, the userland proxy), every peer looks private and the header can be forged —
  to dodge the limit, or to lock a room's address out. Documented in the auth guide.
- **Way out**: a `TRUST_PROXY` setting (a hop count or a list of addresses, as Express's
  `trust proxy`), with the private-peer rule as its default.

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
