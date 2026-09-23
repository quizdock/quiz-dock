# Audio & video

> Part of the [self-hosting guides](README.md). The variables are in
> [configuration → limits](configuration.md#limits--game-pacing).

A question has two media slots: a **visual** (an image or a video) and a
**sound** (an MP3). A video brings its own sound, so a question never has both a
video and a separate sound. Media play in the **projection window**; the
console stays silent, and so do the phones in the room (they show the question's
image), so the room hears everything once. A participant who joins **remotely**
gets the whole question on their device — see [Remote participants](#remote-participants).

## Formats

| Kind | Accepted | Refused |
| --- | --- | --- |
| Video | MP4 with **H.264** video and **AAC** audio (or no audio) | HEVC / H.265 (what an iPhone records by default), AV1, VP9, QuickTime `.mov`, WebM |
| Sound | **MP3** | WAV, OGG, M4A, FLAC |
| Image | PNG, JPEG, GIF, WebP, AVIF | SVG and anything else |

A file is recognised by its **content**, never by its name: a renamed file is
refused. Nothing is transcoded: the file plays as uploaded, its quality is the
author's call. To convert a video, [HandBrake](https://handbrake.fr) with the
*Fast 1080p30* preset gives an MP4 H.264 + AAC; on an iPhone,
*Settings → Camera → Formats → Most Compatible* records H.264 directly.

## Sizes and the reverse proxy

| Variable | Default | Applies to |
| --- | --- | --- |
| `MEDIA_MAX_BYTES` | `10485760` (10 MiB) | an image |
| `MEDIA_MAX_VIDEO_MB` | `50` | a video |
| `MEDIA_MAX_AUDIO_MB` | `10` | a sound |

Behind a reverse proxy, raise its request body limit to the largest of these —
nginx refuses anything over 1 MB by default:

```nginx
client_max_body_size 50m;
```

A quiz bundle carrying videos is limited as a whole by `IMPORT_MAX_BYTES`
(50 MiB by default): raise it to import or share such quizzes.

Media are served with byte ranges (`206 Partial Content`), which Safari requires
to play a video, and cached for good (a media never changes under its id): a
cache or proxy in front may keep them.

## Loudness levelling

When a sound or a video is added, the editor measures its loudness
(ITU-R BS.1770, the EBU R128 method) and its peak. At playback the projection
brings it to the quiz's level with a gain, so the volume does not jump from one
question to the next; the file itself is never modified, and the gain never
raises a sound so much that it clips. Each quiz picks its level in the editor
(**Sound levelling**):

| Level | LUFS | Suits |
| --- | --- | --- |
| Loud | −14 | music, a noisy room (the streaming level) |
| Balanced | −16 | voice and music alike — the default |
| Calm | −23 | a quiet room, lots of headroom (the broadcast level) |

The projector's own volume still sets how loud the room hears it; the level
keeps the questions consistent with each other.

## Timing

Media start with the question, during the three-second reading window. A media
longer than its question stretches the question to the end of the media plus a
pause set once per quiz (**Pause after a media**, 3 s by default, 0–30): nothing
is cut mid-play. The editor shows the resulting time under the question's own.

From the lobby, and then while the leaderboard of a question is up, every
device already fetches what the next question will show or play there (see
[Fetched ahead](#fetched-ahead)), so it plays at once. The host's pause holds the media
and resumes it where it was; if the projection loses a media without the
question being over (the host dropping out, the window reloaded), it resumes a
second before the point it had reached, and the console's **Restart the media**
takes it back to the top.

## Remote participants

When a quiz has a sound or a video, the join form asks each participant where
they play from: **in the room** (they see the projection) or **remote** (a video
call, from home). The console marks the remote ones in its participant list.

**Who hears the sound** is set per quiz in the editor, and per question when a
question needs otherwise; the host can replace the quiz's setting for one
session from the lobby:

| Setting | Projection | Remote participants | Phones in the room |
| --- | --- | --- | --- |
| Projection only | ✔ | the video, muted | the image |
| Projection and remote participants (default) | ✔ | ✔ | the image |
| Every device | ✔ | ✔ | ✔ — echoes if they share a room |

A phone plays sound only after a click in its page; the **Join** click counts,
and the phone keeps the two media elements it started then for the whole
session (iOS lets only those play sound). A participant who reloads the page
mid-session sees **Sound blocked** with a button, as on the projection. Each
participant can mute their own device.

## Fetched ahead

To start at once, each device fetches the next question's media a few seconds
before it appears: in the lobby for the first question, then while the
leaderboard of each question is up. A device fetches only what it will show or
play (the table above): a phone in the room never downloads a video it will not
play, and nothing goes further than one question ahead, to spare mobile data.

**Accepted risk:** the participants' devices thus hold the next question's
image, sound or video before it shows — never its text nor its answers. A
curious participant could open them early; the console's lobby says so.

## Sound on the projection

### Why the projection asks for a click

A browser plays sound only after someone has clicked (or pressed a key) **in
that very window**. A click in the console does not count: the projection is
another window. No web page can get around this rule.

So when a quiz plays any sound, the projection asks for that click as soon as it
opens, at any moment of the session: a full-screen **Turn sound on** overlay.
One click anywhere on it is enough for the whole session. A quiz without any
sound never asks.

If the click was missed (the overlay closed by another click, a window opened
mid-question), the projection says so instead of staying silent: a video goes
on **muted**, a sound shows **Sound blocked by the browser**, and both offer a
**Turn sound on** button.

Opening the projection in Chrome, Edge or another Chromium browser is
recommended: that is where media are checked and played as tested.

### Skipping the click on a dedicated projection computer

When the same computer always drives the projector, the browser can be told to
allow sound for QuizDock without a click. The overlay then never shows: sound is
already allowed.

#### Recommended: allow your instance only (enterprise policy)

Chrome and Edge both read the `AutoplayAllowlist` policy: a list of URL
patterns where media may play with sound without a click. Only these sites are
affected.

**Linux (Chrome)** — create `/etc/opt/chrome/policies/managed/quizdock.json`
(Chromium: `/etc/chromium/policies/managed/`):

```json
{ "AutoplayAllowlist": ["https://quiz.example.org"] }
```

**Windows** — in the registry (or through Group Policy, *Allow media autoplay
on specific sites*):

```
HKLM\SOFTWARE\Policies\Google\Chrome\AutoplayAllowlist\1 = "https://quiz.example.org"
HKLM\SOFTWARE\Policies\Microsoft\Edge\AutoplayAllowlist\1 = "https://quiz.example.org"
```

**macOS** — deploy the same key with a configuration profile (MDM) for
`com.google.Chrome` or `com.microsoft.Edge`.

Use the address the projection is opened from (your `APP_PUBLIC_URL`, or
`http://<LAN IP>:<port>` on a local network). Restart the browser, then check
`chrome://policy` (or `edge://policy`): `AutoplayAllowlist` must be listed. The
policy is not supported on Android or iOS.

#### Alternative: a launch flag (the whole browser)

Starting the browser with

```sh
google-chrome --autoplay-policy=no-user-gesture-required https://quiz.example.org
```

lets **every** site play sound without a click, for that browser process only.
Reserve it to a computer used for nothing else, or to a separate browser
profile (`--user-data-dir=…`) kept for the projection.

References: Chrome [`AutoplayAllowlist`](https://chromeenterprise.google/policies/autoplay-allowlist/),
Edge [`AutoplayAllowlist`](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/autoplayallowlist),
[Chrome's autoplay policy](https://developer.chrome.com/blog/autoplay).
