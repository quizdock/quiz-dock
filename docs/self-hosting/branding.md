# Branding (white-label)

> Part of the [self-hosting guides](README.md). The variables themselves are listed in
> [configuration → identity & branding](configuration.md#identity--branding).

Three things are brandable **at runtime**, without rebuilding the image:

| What | How |
|---|---|
| **Name** | `APP_NAME` (header, tab, share messages). |
| **Language** | `APP_LANG` (`en`/`fr`/`es`/`zh`/`zh-TW`/`tr`). |
| **Logo & CSS** | files served at fixed paths — replace them via a mounted folder, or point `APP_LOGO_URL` at a logo hosted elsewhere. |
| **Icon** | `favicon.png` in the same folder: the browser tab and the home screen (below). |

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

## Icons and the home screen

A page added to a phone's home screen, or installed as an app by a desktop
browser, opens without the browser's bars. At startup the container writes
`/manifest.webmanifest` with `APP_NAME` as the app's name and `APP_LANG` as its
language.

One icon, **optional** (QuizDock's otherwise), for the browser tab and the home
screen: `branding/favicon.png`.

- **PNG, square, 512 × 512**: the browser scales it down for the tab.
- **Opaque**, the logo on its own background: iOS fills transparency with black.
- **Logo in the centre 80 %**: Android may crop the icon to a circle.

It is its own file, apart from `logo.<ext>`: a header logo may well be wide,
an icon has to be square.

A device keeps the icon it installed with: a change shows on a new install.

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

## Customising the look

### Design tokens

`override.css` is loaded after the app's own stylesheet: a variable set in `:root`
there wins. The main ones:

| Token | What it colours |
|---|---|
| `--primary`, `--primary-foreground` | buttons, links, the focus ring, the leaderboard bars |
| `--background`, `--foreground`, `--muted`, `--muted-foreground`, `--border` | the surfaces and their text |
| `--success`, `--destructive`, `--warning` | right / wrong / the second half of a question's time (red for its last fifth), and the rating stars |
| `--warning-text` | words in that amber on a light ground (the double points badge) |
| `--answer-red`, `--answer-blue`, `--answer-yellow`, `--answer-green`, `--answer-purple`, `--answer-orange`, `--answer-pink`, `--answer-teal` | each answer's colour, as the quiz's author picked it (tiles, legends, reveal bars) |
| `--answer-none` | an answer with no colour |
| `--podium-1`, `--podium-2`, `--podium-3` | the podium's steps |
| `--font-sans` | the app's typeface |
| `--radius` | the roundness of cards, buttons and fields |

The colours are in [oklch](https://oklch.com); any CSS colour works.

### Hooks on the live screens

The home page, the participant's phone, the projected screen and the host's console
carry `qd-*` classes that stay the same across versions, whatever their markup
becomes (a change to one is noted in the changelog). They have **no style of their
own**: only yours. States are `data-*` attributes.

| Hook | Where | Attributes |
|---|---|---|
| `qd-shell` | every page's outer frame | `data-shell`: `app`, `participant` (a phone), `bare` (the projection) |
| `qd-header`, `qd-logo`, `qd-main` | the top bar, its logo, the page area | |
| `qd-home`, `qd-pin-form` | the home page, the form to type a PIN (also on `/join`) | |
| `qd-screen` | the projected screen | `data-state`: the game's state (`LOBBY`, `ANSWERING`, `REVEAL`, `LEADERBOARD`, `PODIUM`…) |
| `qd-player` | the participant's phone | `data-state` |
| `qd-console` | the host's console | `data-state` |
| `qd-lobby`, `qd-roster` | the projection's lobby, its list of participants | |
| `qd-join`, `qd-join-pin`, `qd-join-qr` | how to join: the reminder in the projection's top band (a chip on a slide), the PIN, the QR code | |
| `qd-band` | the projection's top and bottom bands | `data-band`: `top`, `bottom` |
| `qd-timer` | a question's clock | `data-tone`: `ok`, `warning`, `critical`, `paused` |
| `qd-chrono` | the console's clock and its ± buttons | |
| `qd-prompt` | a question's text | |
| `qd-rules` | the line under it (one answer, several, double points…) | |
| `qd-answers` | the answers | `data-layout`: `list` (a phone's legend), `images` (picture answers) |
| `qd-answer` | one answer | `data-color`, `data-correct` (`true`/`false`, once revealed), `data-picked` |
| `qd-reveal`, `qd-distribution`, `qd-closest` | the answer revealed, how the room answered, the closest numbers | |
| `qd-explanation` | the explanation shown with the answer | |
| `qd-verdict` | right or wrong, on the phone | `data-correct` |
| `qd-leaderboard`, `qd-leaderboard-row` | the ranking and each line | `data-rank`, `data-you` (the participant's own line) |
| `qd-podium`, `qd-podium-step` | the podium and each step | `data-rank` |
| `qd-slide` | a content slide | |
| `qd-connection-lost` | the banner shown while a device's connection is down | |

`qd-player` and `qd-console` generate no box of their own (the page lays itself out):
use them to scope a rule (`.qd-player .qd-answer`), and `.qd-shell[data-shell="participant"]`
for the phone's background.

A question's or a slide's background carries `data-scheme`: `dark` under light text,
`light` under dark text. Inside it the neutral tokens (`--background`, `--foreground`,
`--card`, `--muted`, `--muted-foreground`, `--border`, `--input`…) are that local
palette's, set by QuizDock; your brand colours (`--primary`, `--answer-*`,
`--success`…) are kept as they are.

Example `branding/override.css`:

```css
:root {
  --primary: oklch(0.55 0.2 150);
  --font-sans: 'Atkinson Hyperlegible', system-ui, sans-serif;
  /* Brand colours for the four usual answers. */
  --answer-red: #d7263d;
  --answer-blue: #1b998b;
  --answer-yellow: #f4a259;
  --answer-green: #2e294e;
  --podium-1: gold;
}

/* A bigger PIN on the projection's lobby. */
.qd-screen[data-state='LOBBY'] .qd-join-pin {
  font-size: 6em;
}

/* Right answers outlined in the brand colour once revealed. */
.qd-answer[data-correct='true'] {
  outline: 0.2em solid var(--primary);
}

/* The last seconds in bold on the big screen. */
.qd-screen .qd-timer[data-tone='critical'] {
  font-weight: 900;
  color: var(--destructive);
}
```

A font of your own needs its `@font-face` (or an `@import` of a font service) in the same
file.
