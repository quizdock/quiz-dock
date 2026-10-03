# Branding (white-label)

Rebrand **without rebuilding**: this folder is mounted read-only over the served
`branding/` directory and replaces the bundled defaults. Everything in it is optional —
an empty folder simply leaves the app with its own logo and no style override.

| What | How |
|------|-----|
| **App name / language** | `APP_NAME` / `APP_LANG` environment variables (see `.env`), or the administration's settings. The backend serves `/config.js` from the current settings: a change applies at the next page load. |
| **Logo** | Drop one `logo.<ext>` here (served at `/branding/logo.<ext>`). Any web format works: the page tries `svg`, `avif`, `webp`, `png`, `jpg`, `jpeg`, `gif` in that order and keeps the first file that loads. Keep a single logo file — with several, the one earliest in that order wins. |
| **Logo hosted elsewhere** | `APP_LOGO_URL` (a CDN URL, a path outside this folder). Set, it skips the lookup below entirely. |
| **CSS override** | Edit `override.css` (loaded last, so it overrides any variable or rule). Optional: remove it and nothing is overridden. |

With no `logo.*` here and no `APP_LOGO_URL`, the header shows the logo bundled in the
build — it is never left empty.

**Logo size.** Rendered 28 px high, width free: keep it between 1:1 and ~3:1 (at 4:1 the
header navigation wraps on a phone). SVG, or a raster at least 56 px high, transparent.

No image rebuild: a change of `APP_NAME` in `.env` applies once the container is recreated
(`docker compose up -d`), one made in the administration at once; a new logo or
`override.css` is picked up on the next page load.

The defaults live in `apps/frontend/src/assets/default-logo.svg` (bundled, the last
resort) and `apps/frontend/public/branding/` (served when no volume is mounted). Mount
targets per setup are listed in
[branding](https://quizdock.github.io/docs/admin/branding/).
