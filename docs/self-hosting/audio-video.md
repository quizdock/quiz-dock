# Audio & video

> Part of the [self-hosting guides](README.md). The variables are in
> [configuration → limits](configuration.md#limits--game-pacing).

> 🧪 **Experimental.** Video and sound in questions, remote participants and the
> wait for media are new. They are built and tested in Chromium browsers (Chrome,
> Edge); **Safari on iPhone has not been tested yet**. Settings, formats and
> behaviour may still change between releases — feedback is welcome in the
> [issues](https://github.com/quizdock/quiz-dock/issues).

A question has two media slots: a **visual** (an image or a video) and a
**sound**. A video brings its own sound, so a question never has both a
video and a separate sound. Media play in the **projection window**; the
console stays silent, and so do the phones in the room (they show the question's
image), so the room hears everything once. A participant who joins **remotely**
gets the whole question on their device — see [Remote participants](#remote-participants).

## Formats

The editor converts every media, **in the author's browser**, to one format per
kind — the server never transcodes:

| Kind | Stored as | Settings |
| --- | --- | --- |
| Image | **WebP** | longest edge at most 1920 px, transparency kept; an animated GIF keeps its first frame |
| Video | **MP4, H.264 + AAC** | short edge at most 1080 px (portrait included), at most 30 fps |
| Sound | **M4A, AAC** | 128 kb/s, stereo at most |

What goes in is whatever the browser can read: JPEG, PNG, HEIC (Safari), MP4,
MOV, WebM, MP3, WAV, FLAC, OGG… A file already in its format and within bounds
is kept as it is (a video is only rewritten to start playing sooner). A long
video is compressed harder to fit the size limit, and refused when even that
would not do. SVG is refused.

Some browsers cannot encode everything: Firefox has no H.264 encoder, so it only
takes videos that need no re-encoding (an H.264 MP4 or MOV within bounds) — use
Chrome, Edge or Safari for the others. Sounds convert in every browser (a
built-in encoder takes over where the browser has none). When a file cannot be
read or converted, the editor says so and points to
[HandBrake](https://handbrake.fr) (videos) or [Audacity](https://www.audacityteam.org)
(sounds).

The server still checks every file by its **content**, never by its name. It
accepts the formats above plus those already stored before the converter (MP3,
PNG, JPEG, GIF, AVIF), which keep playing — imported quizzes may carry them.

## The author's library and credits

**My images / My videos / My sounds**, next to each media field, list what the
author has uploaded — one entry per file, with how many of their quizzes use it.
Picking one puts it to a new use without uploading it again (its alternative
text and credit are copied, then edited separately); an unused entry can be
deleted. Below the list, links to free media libraries
([`MEDIA_LIBRARY_LINKS`](configuration.md#limits--game-pacing); `none` hides
them on an instance without Internet) — nothing is fetched by the server.

Every media has a **credit** field: author, licence, source. A CC-BY or CC-BY-SA
licence asks for it. The credits of a quiz's media are listed on its preview
page and shown in small print under the podium on the projection.

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

## Clean-up

Every hour, and once at start-up, the backend deletes the media nothing uses
any more — images, videos and sounds alike — once they are a day old: an upload
whose form was abandoned, a media replaced in a question, an image taken out of
a text. A media stays as long as a quiz, a session being played or an **archived
session** (its results show the questions as they were) still refers to it. The
same pass deletes the files in `MEDIA_DIR` no media points to any more, such as
the sounds left behind by the 0.7 audio migration; only the names the backend
gives (a media id, a SHA-256) are touched. With several backend instances, one of them runs each pass.

Files are stored once per content, named after their SHA-256: the same image or
sound uploaded twice, or brought back by importing a quiz, takes the room of one.
After an upgrade from 0.7, the first pass moves the existing files under their
new names (`older files moved to shared storage` in the log); the media are
served throughout.

**Instance media** (account menu, `admin` role only — see
[`user:set-role`](cli.md)) shows what the volume holds, by kind and by owner,
the files in older formats, what the clean-up has to do and what holds it back,
and runs it at once. Every file is listed with its owners, size in pixels and
usages, and can be deleted even when used — for moderation: the page lists the
quizzes and past sessions it breaks first, and refuses while a session is
playing it.

The same page manages the **instance media**: images, videos and sounds an
administrator provides to every host — uploaded there, or added from the file
list. Hosts find them in the *Instance media* tab of their media library;
picking one gives them a media of their own on the same file (nothing is
copied on disk), with its alternative text and credit. The instance media are
never cleaned up, and withdrawing one never breaks a quiz.

The width and height of images and videos are read from the files themselves
(the rotation a phone records included); for media stored before, the hourly
pass fills them in.

## Loudness levelling

When a sound or a video is added, the editor measures its loudness
(ITU-R BS.1770, the EBU R128 method) and its peak. At playback the projection
brings it to the quiz's level with a gain, so the volume does not jump from one
question to the next; the file itself is never modified, and the gain never
raises a sound so much that it clips. Each quiz picks its level in the editor,
in the **Sound** fold beside its description (**Sound levelling**):

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

**Listen first, then answer.** A question whose media length is known can tick
**Start the timer when the media ends** in the editor: the answers open only once
the sound or video has played, nobody can answer during it, and everyone then gets
the question's full time (no stretch). The projection and the phones count the
listening down (🎧) before the usual timer. The console's **Restart the media**
still replays it, answers stay open meanwhile.

**Starting together.** The server sets a common start a fraction of a second
ahead, and every device — the projection, the remote phones — starts the media on
that instant of the **server's** clock: each device measures how far its own clock
is off (a few ping/pong exchanges when it connects, then one a minute), so a phone
whose clock is wrong still starts on time. A device that gets the question late
starts where the media is. A pause moves the start with the timer.

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

**Who hears the sound** is set per quiz in the editor (the same **Sound** fold),
and per question when a question needs otherwise (its media, **Playback**); the
host can replace the quiz's setting for one session, first thing in the lobby:

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

A sound is drawn as its waveform, as thick as the question asks (S, M or L in
the question's **Playback**), with a playhead. The projection tells the room where it is about
once a second and at each pause or jump: the screens that show the sound
without playing it — the console, the phones in the room — move their playhead
with it.

## Fetched ahead

To start at once, each device fetches the next question's media a few seconds
before it appears: in the lobby for the first question, then while the
leaderboard of each question is up. A device fetches only what it will show or
play (the table above): a phone in the room never downloads a video it will not
play, and nothing goes further than one question ahead, to spare mobile data.

**Accepted risk:** the participants' devices thus hold the next question's
image, sound or video before it shows — never its text nor its answers. A
tech-savvy participant could open them early; the console's lobby says so.

## Waiting for media

Each device that will play a question's sound or video tells the server once it
has loaded it: the projection, and the participants whose device plays it
(remote ones; in the room, only with **Every device**). Images are not waited
for. In the lobby, the console marks each participant ready or loading and says
whether the projection is ready; the projection shows how many are.

When a question is due and one of these devices is not ready, the room waits: the
projection shows **The question is on its way…** with the count and the seconds
left, the phones say so too, and the console names who is still loading, with
**Start anyway**. The wait ends as soon as every device is ready, when the host
starts anyway, or after `GAME_MEDIA_WAIT_S` seconds (10 by default; `0` never
waits). A device still loading then starts late and jumps to where the
projection is, so the room hears the same moment.

Safari on iPhone often fetches only the start of a file ahead: an iPhone may stay
"loading" until the question opens, and the cap keeps it from holding the room.

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
