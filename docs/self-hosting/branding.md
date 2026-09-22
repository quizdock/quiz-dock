# Branding (white-label)

> Part of the [self-hosting guides](README.md). The variables themselves are listed in
> [configuration → identity & branding](configuration.md#identity--branding).

Three things are brandable **at runtime**, without rebuilding the image:

| What | How |
|---|---|
| **Name** | `APP_NAME` (header, tab, share messages). |
| **Language** | `APP_LANG` (`en`/`fr`/`es`/`zh`/`zh-TW`). |
| **Logo & CSS** | files served at fixed paths — replace them via a mounted folder, or point `APP_LOGO_URL` at a logo hosted elsewhere. |

## How it works

At startup the container serves a tiny `/config.js` generated from `APP_NAME`/`APP_LANG`,
which the SPA reads (`window.__APP_CONFIG__`). Two asset files are served at fixed paths:

- `/branding/logo.<ext>` — the header logo, in any web image format. The page tries
  `logo.svg`, `logo.avif`, `logo.webp`, `logo.png`, `logo.jpg`, `logo.jpeg`, `logo.gif`
  in that order and keeps the first file that loads, so drop **one** logo file with the
  extension you have (no conversion to SVG needed). If none is there, the logo bundled
  in the image is used — the header is never left empty. Setting `APP_LOGO_URL` skips
  this lookup entirely and loads that URL instead.
- `/branding/override.css` — an extra stylesheet loaded last, so you can override any
  CSS variable or rule. It is **optional**: when the mounted folder has no `override.css`,
  the server answers an empty `204` and nothing is overridden. The bundled default is
  intentionally near-empty.

## Override logo & CSS

Put your own logo (`logo.png`, `logo.svg`, …) and, if you want one, an `override.css`
in a folder, and mount it over the served `branding/` directory. In the single image it
lives at **`/app/client/branding`**:

```bash
docker run -p 18080:3000 \
  -v quizdock:/data \
  -v "$PWD/branding:/app/client/branding:ro" \
  -e APP_NAME="Acme Quiz" -e APP_LANG=fr \
  fchaussin/quizdock:standalone
```

With `docker-compose.prod.yml`, uncomment the branding volume line:

```yaml
    volumes:
      - mediadata:/data/media
      - ./branding:/app/client/branding:ro   # ← your logo.<ext> (+ override.css)
```

Example `branding/override.css` (recolor the primary):

```css
:root {
  --primary: oklch(0.6 0.2 20); /* QuizDock uses oklch design tokens */
}
```

> The mount replaces the whole folder, bundled defaults included, and both files are
> optional: with no `logo.*` in it the header falls back to the QuizDock logo, and with
> no `override.css` nothing is overridden. Keep only one `logo.*` file — a leftover
> `logo.svg` wins over your `logo.png`.

> **Logo size.** It is rendered 28 px high with a free width, so any ratio works, but
> keep it between 1:1 and ~3:1 — at 4:1 the header navigation wraps on a 360 px-wide
> phone. SVG, or a raster at least 56 px high with a transparent background.
