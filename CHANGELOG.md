# Changelog

All notable changes to QuizDock are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com); versions follow
[Semantic Versioning](https://semver.org). Generated from conventional commits.

## [0.14.0] - 2026-10-05

### Bug Fixes

- Checks sign in whatever the language; screenshots pass the standings step *(tools)*
- The preview's button says Pin, not Pin to the top *(editor)*
- The console sees who is ready in a lobby whose first step has no media *(live)*
- Patched brace-expansion, form-data, browserslist and esbuild in the dev tooling *(deps)*
- In the next quiz's lobby, the feedback is on the previous quiz *(player)*
- A long quiz title is cut, the PIN alone in the lobby, menus stay in the window *(console)*
- The settings' warnings are settings to review, not ones that contradict each other *(i18n)*
- The home says the instance is not fully set up yet *(i18n)*
- The dev Keycloak takes localhost:15173 back too, beside the device address *(dev)*
- The transport in the header; the window holds the console, the side column scrolls *(console)*
- One layout for every band, guards for long names, titles and addresses *(projection)*
- Standings down to the bottom band; one-line bands on a narrow screen *(projection)*
- The room's standings from the top, the invitation centred beside them *(projection)*
- A crowded room fits the screen; no participants' list beside the standings *(projection)*
- A portrait projection stacks its lobby; a start that finds the host gone frees Start *(live)*
- The console's transport above the outline; fixes from the audit since v0.13.2 *(live)*
- Previews at the projection's 16:9, the side column kept in every view *(console)*
- Stop a quiz, leave or close the room — one verb each, set in the glossary *(i18n)*
- A true or false question starts with True and False in the quiz's language (#197) *(editor)*
- Orval 8.39 and vitest 3.2, out of their critical advisories; API client regenerated in a container (#205) *(deps)*

### Build

- Bump the actions group across 1 directory with 12 updates (#203) *(deps)*
- Bump markdown-it from 14.2.0 to 14.3.2 (#202) *(deps)*
- Bump baseline-browser-mapping from 2.10.34 to 2.11.27 (#201) *(deps)*

### Documentation

- Taken again for the release *(screenshots)*
- What to check before tagging, the tools' scripts included *(release)*
- Four small gaps of the live game recorded as technical debt *(dev)*
- The standings during a live game, for the presenter and the projection (#198) *(spec)*

### Features

- Global media dropped in, bulk actions, unused files, a sticky filter bar *(admin)*
- The navigation as tabs, no group labels; the quiz's pace first in the settings *(admin)*
- Ready and remote on the avatars, status columns, salle d'attente in French *(live)*
- The host looks back from a paused question; Resume brings it back *(live)*
- The reading window runs red stripes, the clock still; no fading in a pause *(live)*
- No Tab to switch views, a wider side column, the projection window at the row's end *(console)*
- The answer shown for, its auto value, answer choices, and a preview that stays *(editor)*
- The next quiz is always picked in the room's lobby (#198) *(live)*
- The host's interface language, the quiz's or the room's for the audience (#209) *(i18n)*
- Live standings on the console, the next quiz's countdown, standings by the lobby (#198) *(live)*
- Standings after each reveal, every score for the host, next quiz on its own (#198) *(live)*

### Contributors

- Francois Chaussin
- dependabot[bot]
- lutfullahkabalak
- François CHAUSSIN

## [0.13.2] - 2026-10-03

### ⚠️ Breaking changes

> [!WARNING]
> Read before upgrading.
> - **Download the latest quizdock script before upgrading (curl -fsSLO https://raw.githubusercontent.com/quizdock/quiz-dock/main/quizdock): the copy you have does not fetch the Compose files. On a first upgrade with it, an existing install gets the release's files as <file>.new; compare and adopt them (mv), or Keycloak and the hardening of this release stay out.**

### Bug Fixes

- The dev backend gets the instance's name, language, logo and feedback link *(dev)*
- The player's screen says what happens, and which answer was right *(a11y)*
- The console's view tabs have a name on a small screen *(a11y)*
- What was fetched ahead for a step that never came is let go *(live)*
- One move of the sequence at a time *(editor)*
- The join address the host chose stays when the PIN panel opens again *(console)*
- Sharing over plain http shows the link to copy *(console)*
- Blocked site data no longer breaks the podium or local sign-in *(web)*
- The reveal's "your answer" is what was sent *(live)*
- Numbers, dates and plurals as the instance's language says them *(i18n)*
- Validation messages for zod 4's codes *(i18n)*
- A field's error is announced as it appears *(a11y)*
- The media file picker is reached by the keyboard *(a11y)*
- The ⋯ menus work with the keyboard; Escape closes only what it is meant for *(a11y)*
- An answer that is not JSON keeps its status *(web)*
- A reading again that fails keeps the open editor *(editor)*
- A double click adds one slide, creates one quiz *(editor)*
- Discarded changes stay discarded *(editor)*
- Images from the lockfile as committed, their code read-only to the app *(docker)*
- Every response says nosniff and keeps its address to itself *(app)*
- An image is shown only for a media id *(markdown)*
- A host's media added to the instance's leaves its declared original behind *(media)*
- A bundle's description is bounded as the editor's is *(import)*
- A picture of more than 40 megapixels is refused *(media)*
- The form beside a file is bounded *(upload)*
- An MP4 is read box by box, up to a bound *(media)*
- A stranger can no longer keep the setup wizard locked *(admin)*
- The host seat is local mode's only *(auth)*
- Refusals of rights are audited a few per account and window *(admin)*
- A socket sends within a budget, joins once, and readies only real steps *(game)*
- Wrong PINs are counted per IPv6 /64, not per address *(game)*
- An e-mail is kept only as the provider vouches for it, and never locks an account out *(auth)*
- An expired host seat shows as free on the accounts page *(admin)*
- After a restart, a room whose host is gone still ends *(game)*
- Calls to the provider give up after 5 s, and a renewal frees only its own lock *(auth)*
- Migrations make no request to Prisma's telemetry *(docker)*
- A stop closes the server cleanly; qd commands leave the media clean-up alone *(app)*
- An upload limit above 64 MB can be changed again *(admin)*
- The single image serves its icon and manifest at the root (#189) *(app)*
- A large room's results are kept *(game)*
- Local mode, the actions open once the token is given *(admin)*
- An answer given while the connection is down is not lost *(live)*
- A refused request gets its refusal as its answer *(live)*
- Another room's page gets a socket of its own *(live)*
- A row's dialog stays on its quiz or account when the list is reordered *(admin)*
- A poll turned into another type is worth points again *(editor)*
- A played quiz or question can be deleted *(quizzes)*
- 26.7.5, and a stricter example realm *(keycloak)*
- A media is served only as a type the upload recognises *(media)*
- An ID token is not taken as an access token *(auth)*
- Names and comments typed by a client lose their control characters *(game)*
- An answer is checked before it is graded *(game)*
- The same-origin check covers every path, whatever its case *(auth)*

### Build

- Pnpm 11.28.3, pinned by its hash

### Documentation

- The notices say a coming quizdock release will move an existing install's roles *(db)*
- Comments that described what the code no longer does *(code)*
- The OpenAPI document declares its bearer scheme, and says 201 where a route creates *(api)*
- What Redis holds, how often the update check asks, when a demo resets *(settings)*
- The developer docs say what the code does now
- An operation note's text is what the web shows *(contracts)*
- One way to report a vulnerability, the one that works *(security)*

### Features

- Every empty zone says so with EmptyState, its icon and its text *(ui)*
- The Tab key cycles the views only once the host turns it on *(console)*
- Save a question without closing it, Cmd/Ctrl+S, save before switching (#195) *(editor)*
- Open a quiz by clicking its title (#196) *(admin)*
- Over HTTPS the session cookies are bound to the host; Health says what weakens sign-in *(auth)*
- A new install's QuizDock owns its database, not the PostgreSQL server *(db)*
- A new full install gives Keycloak its own database role *(keycloak)*
- Passwords left to their default are said, never refused *(doctor)*
- An install whose Compose files are older than its image is told so *(admin)*
- Upgrade brings the release's Compose files too, never over an edited one *(quizdock)*
- /health/ready says whether the database and Redis answer *(health)*

### Performance

- The editor, the history, the catalogue and the administration load when opened *(web)*
- Media go into the bundle as they are *(export)*

### Refactor

- Every keyboard shortcut goes through react-hotkeys-hook *(ui)*
- Drop game:created, which nothing listens to; the validate route is documented *(game)*
- One list of the routes served at the root, for the server and its OpenAPI document *(app)*
- Quiz.visibility, never read nor written, dropped *(data)*
- Code nothing calls any more, removed

### Contributors

- Francois Chaussin
- lutfullahkabalak
- drpalmer68

## [0.13.1] - 2026-10-02

### Bug Fixes

- The empty history names the checkbox as the console shows it *(web)*
- The database, Redis and the app come back after a reboot *(compose)*
- A standalone instance follows QUIZDOCK_TAG *(cli)*
- The page says the instance's language, not French *(web)*
- The demo seat never expires; the proxy warning names no nginx *(settings)*
- The setup token works once and expires 24 hours after it was created *(web)*

### Documentation

- The Docker Hub overview is docker/README.md *(releasing)*
- The Documentation moves to quizdock.github.io; READMEs for GitHub and Docker Hub
- The community catalogue in the self-hosting guides, six languages in the glossary
- The web administration, settings changed from it, community quizzes, the dev accounts *(readme)*
- Every screen shot again, the administration's pages among them *(screenshots)*

### Features

- The invitation address set from a phone test; the update from Health *(admin)*
- Init asks whether administrators may change settings from the browser *(cli)*
- The environment reference as data, rendered by the website *(settings)*
- An invitation to star QuizDock on GitHub, beside the feedback links *(web)*
- A newer release announced in the administration and by quizdock status *(admin)*

### Contributors

- Francois Chaussin

## [0.13.0] - 2026-10-02

### Bug Fixes

- Answer the application's own pages only *(api)*
- Audit — menus never clipped, the media page in its layout, a11y *(web)*
- Audit bugs — one way to run an operation, pages that keep their data *(web)*
- Audit bugs — settings read on use, imports, timeouts, last admin *(admin)*
- Security audit — tokens, secrets, export, errors *(admin)*
- The quizzes' row menu behind the vertical ellipsis, as everywhere *(web)*
- The quick setup forces no answer *(web)*
- The administration opens on the quizzes, the instance's settings after *(web)*
- A setting's history in the administration's units *(web)*
- Pass GAME_ALL_ANSWERED_DELAY_MS to the backend *(compose)*
- An unreadable PORT falls back to 3000 *(app)*
- An unreadable IMPORT_MAX_BYTES falls back to 50 MiB *(quizzes)*
- Report the authentication mode the backend runs in *(health)*
- Make community access opt-in and reuse verified quiz previews *(store)*
- Keep DNS lookup within download deadline *(store)*

### Documentation

- The pages and the API on one origin *(upgrading)*
- Changing settings, presets and quizzes from the administration *(self-hosting)*
- The configuration warnings and what doctor checks *(self-hosting)*
- Generate the environment reference and .env.example *(self-hosting)*

### Features

- Health and setting issues said in the page's language *(admin)*
- Accounts, health and audit as pages, not command output *(web)*
- Empty zones of the administration as placeholders with an icon *(web)*
- The administration in the top bar, beside the app's pages *(web)*
- Statistics — the last twelve months of use *(admin)*
- Statistics, the administration's home — what is played right now *(admin)*
- The administration's media, a detail panel beside the list *(web)*
- The administration's quizzes, a real list *(web)*
- The quick setup, first step of the setup wizard *(web)*
- Presets become the quick setup of a new instance *(admin)*
- The look of the instance — palette and answer themes *(web)*
- Answer themes *(admin)*
- The instance's palette, served as a stylesheet *(admin)*
- The phone test of the invitation addresses, again from the Health page *(web)*
- The setup wizard *(web)*
- The setup of a fresh instance, behind a setup token *(admin)*
- Change the settings, apply presets, manage quizzes *(web)*
- Presets on independent axes *(admin)*
- Change settings and manage quizzes as an operation *(admin)*
- The administration, reading *(web)*
- The admin API, and the media page through the runner *(admin)*
- Qd runs every command through the runner *(cli)*
- Administrative operations, the runner and the audit *(admin)*
- /config.js comes from the backend in every setup *(app)*
- Report configuration problems at start and in qd doctor *(admin)*
- The settings registry and the service that resolves it *(admin)*
- An icon, a home-screen manifest, long cache for built files, screen kept on in games (#181) *(app)*
- The community store in Turkish *(i18n)*
- Add optional community catalogue *(store)*

### Refactor

- Audit — indexes, one read per game, cleanups, risky paths tested *(admin)*
- The administration's tables on DataTable *(web)*
- The settings injected into the administration's classes *(admin)*
- The operations' results typed once, in contracts *(admin)*
- Themes out of the administration's scope *(admin)*
- Read the environment through the settings registry *(backend)*

### Contributors

- Francois Chaussin
- François CHAUSSIN
- lutfullahkabalak

## [0.12.0] - 2026-10-01

### Bug Fixes

- The big screen on a phone is the stage, fitted — no piled-up bands (#170) *(player)*
- The filter bars fit a phone — one shared filter field (#168) *(ui)*
- Form controls inherit the base size, no focus zoom on phones (#164) *(ui)*
- The sample-media container runs as node, with no healthcheck *(tools)*

### Documentation

- The connector is experimental (#166) *(mcp)*
- The sample quizzes, the Kahoot import and Turkish *(readme)*
- Every screen shot again on the reworked UI, and a new demo GIF *(screenshots)*

### Features

- Picture placement on the projection, room played quizzes, quiz filters, English Türkiye (#171)
- A motion layer under the live screens (#169) *(live)*
- A full preset with a bundled Keycloak (#149) *(self-hosting)*
- A local connector to validate and import quizzes (experimental) (#153) *(mcp)*
- A demo stack, and the screenshots and demo GIF taken on it *(tools)*
- The shared account starts with the sample quizzes in its bank *(demo)*
- Three sample quizzes with media and every question type *(samples)*

### Contributors

- François CHAUSSIN
- lutfullahkabalak
- Francois Chaussin

## [0.11.0] - 2026-09-30

### Bug Fixes

- Engine.io 6.6.11 — GHSA-2gc4-cqfq-p2gv (protocol revision mismatch DoS) *(deps)*
- Refresh Turkish translations for dev UI *(i18n)*
- Avoid Turkish suffixes on host names *(i18n)*
- Bound each archive inflater chunk *(import)*
- The app's one pagination *(reviews)*
- The peek's socket specs expect the room it now names; an unnamed room says null *(join)*
- A menu that drops down opens from vertical dots *(ui)*
- The room's name is the page heading again *(projection)*
- Every error code the server can send has its text, and a test keeps it so *(i18n)*
- What sits on a question or slide background stays readable, whatever the background *(live)*
- The question background covers the whole screen, answering included *(player)*

### Documentation

- A CONTRIBUTING guide and a PR template — pull requests go to dev
- The UI system — rules and the three-lot rework settled in review *(specifications)*

### Features

- Add Turkish locale *(i18n)*
- A question may last up to 240 s, as in Kahoot *(questions)*
- A Kahoot sheet opens as a draft to finish, its report in the editor *(import)*
- Support Kahoot spreadsheet templates *(import)*
- The console controls all of the projection's sound (#150) *(sound)*
- Instance media — labelled filters, actions in the preview, delete says why not *(admin)*
- State and players first, Close the room… apart, Resume as the main action *(rooms)*
- Sortable tables, dates in the interface's language, a way to a first session *(history)*
- A profile in plain words, one menu everywhere, the seat released with Undo *(account)*
- Who joins what, ready at the thumb, and a way on at every end *(phone)*
- Sign in in one step, and never a dead end *(auth)*
- One way into a room — six boxes, the room named at the 6th digit *(join)*
- A quiz's status has one colour everywhere; a read-only quiz says No questions yet *(ui)*
- The slide form validates like the question, empty blocks flagged, removal undone *(editor)*
- The card opens the quiz, one action in view, the rest in ⋮ *(dashboard)*
- A media's alt text and credit are saved with the form *(editor)*
- A stable frame — the title saves itself, the rare actions in ⋯ *(editor)*
- The question form puts the answers first, with a live preview *(editor)*
- A question's clock stands at its full time *(preview)*
- The room's own screens — projection or phone, the answer on request *(preview)*
- A template's page is the quiz preview, fed by the import itself *(templates)*
- Permissive validation — drafts save what holds, publishing asks for completeness *(editor)*
- A fixed frame — where the game is and how to join on top, the room's state below *(projection)*
- One frame for every phase — state on top, the step in the centre, the quiz aside *(console)*
- The host's outline carries the slides, so it shows every step *(live)*
- Foundations of the UI system — field contrast, tokens only, titles, notices, no dead end *(ui)*

### Contributors

- Francois Chaussin
- lutfullahkabalak

## [0.10.0] - 2026-09-28

### Benchmarks

- Several rooms at once measured, the series sampled a second time *(perf)*
- Several rooms at once, and a results file per measure *(bench)*
- Additional information on the execution context, the resources allocated *(perf)*
- Each measure of the day with its code, its machine, its method and its limits *(perf)*
- The benchmark's full setup, next to its figures *(perf)*
- The benchmark measured cold, one room holds about 1500 players *(perf)*
- The answer count's coalescing measured, warm and indicative *(perf)*
- The sizing series and the A/B of the load benchmark in one script *(bench)*
- A --rich quiz, as long as the editor lets questions be *(load)*
- Draft roadmap of the live engine's performance *(perf)*
- Benchmark a live game from 10 to 700 players *(load)*

### Bug Fixes

- The console's chrono shows the pause sign, as the screens do *(console)*
- Time the host adds while resuming is kept *(game)*
- One question clock for the screen, the phones and the console *(live)*
- No new session when the language changes or the Projection tab opens *(live)*
- A saved or deleted element releases every media it held *(media)*
- A copy named in its own language, made whole or not at all *(quizzes)*
- The background field follows its value after a draft is discarded *(editor)*
- A page that cannot load says why, not "not found" or nothing *(ui)*
- What the account may do follows a change of identity at once *(auth)*
- Failed actions say so instead of failing silently *(ui)*
- A question's options keep distinct keys after a reload *(editor)*
- Saving the title no longer writes back the old language *(editor)*
- A question's background only while the question is on screen *(projection)*
- Countdowns stop ticking once their deadline is past *(live)*
- Adjusting the time no longer resets an order being put together *(player)*
- The Tab key moves the focus again, switching views only from the page *(console)*
- A phone that leaves can join again, and no connection leaks *(live)*
- Load override.css after the app's stylesheet *(branding)*
- A catalogue index that survives a crash and two shares at once *(store)*
- Answer database errors with their meaning, and stop pg's overlap warning *(api)*
- Check every place an author puts a media in, in one way *(media)*
- Keep the room's players and answers right under concurrency *(game)*

### Documentation

- The thanks name Anthropic's GitHub account and Claude Code *(readme)*
- The release is 0.10.0, not 0.9.1
- The rooms table only, and the results directory introduced *(readme)*
- The benchmarks in the changelog, a performance summary in the README
- Ready for 0.9.1 — its changelog, version examples, upgrade note, thanks
- The answer count coalesced, the sounds off in a new room, the measures to redo cold
- The benchmark after the lots, and a sizing page for operators
- What each lot fixed, the profile of the engine, and the unreleased changes
- Record the decisions taken on the audit's open points *(audit)*
- Code audit of backend and frontend, to decide lot 4 *(audit)*

### Features

- A new room's game sounds are off, the host turns on the ones they want *(game)*
- Hooks on the live screens for an instance's override.css *(branding)*
- Tokens for the answers' colours, warning, podium and typeface *(theme)*
- The live pages say when their connection is lost *(live)*

### Performance

- The room's answer count sent at most every 100 ms, not on every answer *(game)*
- The instance's language alone downloaded, not all five *(frontend)*
- A game's snapshot parsed once, not on every answer *(game)*
- A joining device's preload reads its own record only *(game)*
- The join page's peek reads the game once *(game)*
- One definition of where a media is used, the library 100 times faster *(media)*
- The auth guard writes the user only when something changed *(auth)*
- Walk keys with SCAN, never KEYS *(redis)*

### Refactor

- The console's repeated blocks written once *(console)*
- One hook for a room device's media, projection and phone alike *(live)*
- One PIN form for the home page and the join page *(join)*
- Where the device follows from, worked out once *(player)*
- One draft hook and one action bar for the question and slide forms *(editor)*
- The editor's five small pickers on Segmented *(editor)*
- One Modal for the four native dialogs *(frontend)*
- One checkbox field, label and hint, for six places *(frontend)*
- The slide being edited previewed by slideShowOf *(editor)*
- One helper for a library media's address *(frontend)*
- The session's 29 events, taken on and off from one table *(live)*
- One encoding for the room and game hashes, field names checked *(game)*
- One reader of the live players, answers and snapshot *(game)*
- The questions-only reorder and the samples route marked deprecated *(api)*
- One host guard, and a player's own room only *(game)*
- Small duplicates and misplaced comments from the audit *(backend)*
- One check that a quiz is within reach, one "readable by" *(quizzes)*
- One way to write a question's and a slide's content *(quizzes)*
- Split timers, results and steps out of the engine *(game)*

### Contributors

- Claude

## [0.9.0] - 2026-09-27

### ⚠️ Breaking changes

> [!WARNING]
> Read before upgrading.
> - **An OIDC_ISSUER ending in `/` while the provider's issuer does not (or the reverse) no longer signs in: set it to the provider's issuer, as the backend log and `quizdock doctor` point out.**

### Bug Fixes

- An image choice keeps the projection's usual layout *(live)*
- A picture's description arriving late overwrites nothing *(editor)*
- No image added from the Markdown editor *(editor)*
- No image to upload in an answer's explanation *(editor)*
- A new quiz's intro slide comes first, before its question *(quiz)*
- The ding back at 880 Hz, its low-pass down to 300 Hz *(sounds)*
- The ding down to 300 Hz, as chosen by ear *(sounds)*
- The ding down to A5 (880 Hz) *(sounds)*
- A gentler ding — lower, softer attack, faint strike *(sounds)*
- The ding's low-pass tames it for real *(sounds)*
- Every device keeps to the room's instant while it plays *(media)*
- Each device starts ahead by its output latency, heard together *(media)*
- The waveform follows the sound as heard, not as decoded *(media)*
- A phone in the room shows the slide's background, one waveform on the console *(slides)*
- No fullscreen on the big screen shown in a participant's page *(live)*
- A new question starts at 0 answers — its first answer gets its tick *(live)*
- A question's media a second after it shows, replays in the same room, tiles and ticks *(live)*
- The tick's description, plainly *(live)*
- Answer tiles at line-height 1em *(live)*
- Tighter answer tiles, a track from the answers' opening, the focus on a typed answer *(live)*
- The time bar turns amber then red on every screen; the last answer gets its tick *(live)*
- The sounds hint — the track makes way for a question's sound, then comes back *(live)*
- The sounds hint says the track stops under a question's own sound *(live)*
- No track under a question with its own sound, and no sidechain *(media)*
- A fade in of a few milliseconds, just the click off the attack *(media)*
- The format guide writes the version it needs; a hidden waveform through the database *(bundle)*
- The transport holds its locks through a pause, and works without a projection *(live)*
- The console's waveform follows the sound, the screen's sound button top left *(live)*
- A refused answer is never shown as saved, and the server says why *(live)*
- Room, quiz, session — one word for each level *(i18n)*
- No way out to another PIN from a room's podium *(live)*
- Ask a phone for sound until its media elements are claimed *(live)*
- Smoother French for the remote presence hint *(i18n)*
- Compare the OIDC issuer exactly, trailing slash included *(auth)*
- A manager reads another host's quiz, and a failed save says so *(editor)*
- Start a quiz in the instance language, and let the author change it *(quiz)*
- Bound the archive on the bytes actually unpacked *(import)*

### Documentation

- The 0.7 and 0.8 notes out of the top *(readme)*
- Ready for 0.9.0 — upgrade between two games, version examples, unreleased
- Every screen shot again, the new ones and each question type *(screenshots)*
- The 0.7 and 0.8 notes out of the top *(readme)*
- Image choice in the feature list and unreleased
- The 2026-09-27 batch listed, video and sound no longer experimental
- Media on slides, as arbitrated — blocks, a video background, one sound at a time *(spec)*
- The game's sounds in the feature list and unreleased
- Closing a quiz mid-way in unreleased *(changelog)*
- The track and the mixers' mutes in the feature list
- The room's sounds, the track and the mixers in unreleased *(changelog)*
- The console transport, the hidden waveform and the bank's views listed
- The fades of the audio routing *(spec)*
- The format guide and the chatbot prompt in unreleased *(changelog)*
- The projection on a device, Ready! and the game's sounds in the feature list
- The sound button and the mixers in unreleased *(changelog)*
- The game's sounds in unreleased *(changelog)*
- The audio mixer in unreleased *(changelog)*
- Ready in the lobby in unreleased *(changelog)*
- The projection on a participant's device in unreleased *(changelog)*
- The room on screen in unreleased *(changelog)*
- The next quiz's picker is a small index *(ui)*
- The room in history in unreleased *(changelog)*
- The playlist goes to a later Programme, out of the room *(spec)*
- The room's standings in unreleased *(changelog)*
- The next quiz in the room in unreleased *(changelog)*
- Game sequencing by events, and the engine split, after the room *(roadmap)*
- The room layer in unreleased *(changelog)*
- The multi-quiz room brief, from the model to the ordered pull requests *(spec)*
- One answer grid in unreleased *(changelog)*
- Exact OIDC issuer in unreleased *(changelog)*
- Unreleased before the release *(changelog)*
- The licence, tags and language of a quiz in the feature list
- The refactoring plan for the game gateway tests *(dev)*
- #91 is merged *(spec)*
- The community store brief, from the model to the road to opening *(spec)*
- Unreleased after merging the store prerequisites *(changelog)*
- The image retention policy for Docker Hub (proposal) *(releasing)*
- Manager read-only view in unreleased *(changelog)*
- Export for publication in unreleased *(changelog)*
- Quiz language in unreleased *(changelog)*
- Bundle JSON Schema in unreleased *(changelog)*
- Bounded import archive in unreleased *(changelog)*
- The licence and the tags are set in the quiz settings *(bundle)*
- Licence and tags of a quiz in unreleased *(changelog)*
- The README no longer opens on the 0.8 breaking change
- The README no longer opens on the 0.8 breaking change
- The 0.8 breaking change at the top of the README
- The README warns OIDC deployments about the 0.8 breaking change
- Breaking changes in a warning box, impossible to miss *(changelog)*
- The README and the CLI guide at 0.8, the media library as what is new

### Features

- The pictures on the phone in the room too *(player)*
- Name a picture answer by its alt, in the history, the CSV and the templates *(history)*
- Answer an image choice — the pictures at a distance, the shapes in the room *(player)*
- Project an image choice — the pictures fill the screen, the reveal keeps them *(live)*
- Write an image choice — pictures, their alt, 2 or 4, one or several right *(editor)*
- Play the image choice as the choice it is scored as *(game)*
- Image choice type, its rules and bundle version 6 *(questions)*
- Offer to move an image of the prompt to the question's media *(editor)*
- Answer shapes drawn in SVG, a softer ding, a wider label column *(ui)*
- The grid shows each quiz's first slide, fetched once in view *(quizzes)*
- Archived quizzes out of the list by default *(quizzes)*
- Filter by owner, and by several statuses at once *(quizzes)*
- Wrong answers greyed in the step preview and its settings *(quiz)*
- The read-only view as the editor lays it out, with each step's settings *(quiz)*
- The read-only view shows each step as it will show *(quiz)*
- Spinners and skeletons while pages load *(ui)*
- Share a quiz with the instance's other hosts *(quiz)*
- A new quiz starts from a draft — an intro slide and a question *(quiz)*
- Variables in a slide's text, filled wherever it shows *(slides)*
- The space bar pauses the game, a bin removes a participant *(console)*
- A softer ding, generic names for the effect slots *(sounds)*
- One second after a media by default for a new quiz *(quiz)*
- A slide's video and sound, set like a question's media (#125) *(slides)*
- Video and sound on slides — model, engine, bundle v5 (#125) *(slides)*
- Each answer's tick slightly higher or lower — no machine gun *(live)*
- Everyone answered, the reveal a second later — the last tick apart from the gong *(live)*
- Each room effect says when it plays *(live)*
- The room's effects in one compact list — a sample for each, a preview here *(live)*
- A ding as a question starts; no gong from the last question's end *(live)*
- A countdown on the last five seconds, the gong on zero, a new gong *(live)*
- Close the quiz mid-way and pick the next one, the room kept *(live)*
- A mute per channel on the room's mixer, for every screen *(live)*
- The room's sounds — built in, or a sound of the library with the editor's picker *(live)*
- The track makes way for a question's sound and comes back; a mute per channel *(media)*
- The track keeps its place, a sidechain makes way for the quiz, tapered faders *(media)*
- Fades on every start and stop — the host's transport, the samples, the track *(media)*
- My quizzes and the templates — filters, a list or a grid, richer items *(ui)*
- A waveform hidden from the screens, still on the console — manifest v4 *(media)*
- The host steers the question's media from the console *(live)*
- The participant's lobby — an avatar draft, a ready button that breathes *(live)*
- A format guide from the importer, and a chatbot prompt to bring a quiz in *(bundle)*
- A sound button, and a mixer for the room and for each device *(live)*
- The game's sounds — a tick, a gong, a background track *(live)*
- An audio mixer — every source into a bus, then the master *(media)*
- "Ready!" in the lobby, and one count for the host *(live)*
- The projection on a participant's own device *(live)*
- A room of its own name, not the quiz's *(live)*
- The next quiz picked from a small index of the host's quizzes *(live)*
- A searchable picker for the room's next quiz *(live)*
- The room on the console, the projection and the phones *(live)*
- Ratings and sound follow the room's quizzes *(game)*
- A session played in a room shows its room *(history)*
- The room's standings, summed over its quizzes *(game)*
- The next quiz in the same room, the players still in *(game)*
- The question fits the screen, the clock as a bar *(live)*
- One answer grid on the projection and the phone *(live)*
- Export a quiz for publication to a community store *(editor)*
- Publish the manifest as a JSON Schema, one file per version *(bundle)*
- Set the licence and the tags of a quiz *(editor)*

### Refactor

- One step preview for every page, its content centred *(quiz)*
- The room under its PIN, each game under its own id *(game)*

### Contributors

- fchaussin

## [0.8.0] - 2026-09-25

### ⚠️ Breaking changes

> [!WARNING]
> Read before upgrading.
> - **OIDC configuration changed (OIDC_SESSION_SCOPE removed; new OIDC_INTERNAL_URL, OIDC_CLIENT_SECRET, TRUST_PROXY; everyone signs in again), see <https://github.com/quizdock/quiz-dock/blob/main/docs/self-hosting/upgrade-oidc-session.md>**

### Bug Fixes

- A fresh install starts: the templates folder belongs to the app *(docker)*
- Quizdock init writes the new OIDC settings *(cli)*
- Keep the session alive through a long game; words for the new errors *(auth)*
- Say why a sign-in failed in the log; a stable Keycloak issuer in dev *(auth)*
- The template page draws its slides as the stage does *(store)*
- A template card draws its first slide as the stage does *(store)*
- The OIDC session survives a new tab *(auth)*
- The wrong-PIN window opens with SET NX, on any Redis version *(game)*
- An original uploaded again is reused, not converted into a duplicate *(media)*
- The administration page says when an action on the instance media fails *(media)*
- Keep file names as typed, and a library entry kept for past results *(media)*
- Judge a conversion on the tracks that play, and word what the codecs throw *(media)*
- Adopting older files never holds up the clean-up, nor empties a restored volume *(media)*

### Documentation

- Unreleased changes *(changelog)*
- The sample quizzes wait in the templates *(auth)*
- Unreleased changes, with the OIDC upgrade notes *(changelog)*
- Upgrade notes for the OIDC session held by the backend *(auth)*
- The session held by the backend, OIDC_INTERNAL_URL and TRUST_PROXY *(auth)*
- Unreleased changes *(changelog)*
- Player view with the answer tiles pinned at the bottom *(screenshots)*
- One commented .env example per setup: standalone, local, OIDC
- The preview in plain words
- The README in the words of the people who use it
- Participant access, safeguards, CSP and preview in the README; new screenshots
- A technical debt register, starting with the OIDC tokens in the browser
- The media library in the README (and on Docker Hub), new screenshots
- Name the multi-arch builder instead of making it the default *(releasing)*
- Media library and in-browser converter *(spec)*

### Features

- No token in the browser any more, the session is a cookie *(auth)*
- The backend holds the OIDC session, the browser a cookie (BFF) *(auth)*
- Name the proxies allowed to speak for the client (TRUST_PROXY) *(security)*
- Answer tiles pinned to the bottom, up to four per row *(player)*
- Free libraries under open licences for every kind by default *(media)*
- A Content-Security-Policy on every page *(security)*
- The OIDC session shared by the tabs or per tab (OIDC_SESSION_SCOPE) *(auth)*
- Navigation above the stage, questions in 16:9 like the projection *(preview)*
- "remember my choice" in the launch dialog, set in the profile *(live)*
- Close or reopen the game to newcomers during play *(live)*
- Launch dialog for participant access, lobby lock, docs *(live)*
- Open access for participants, lobby lock, wrong-PIN limit *(game)*
- Account preferences, remembered wherever one signs in *(users)*
- An empty state like the editor's when no template is shared *(templates)*
- Invite bug reports, feature ideas, translation fixes and questions *(home)*
- One file list with Global, list or grid, and a preview *(media)*
- Sizes in pixels, and media the instance provides to every host *(media)*
- An administration page for the instance's media *(media)*
- The author's library, credits, and free libraries to look in *(media)*
- Convert every media in the browser to one format per kind *(media)*
- Store each file once, named after its SHA-256 *(media)*
- An hourly job deletes unused media and stray files *(media)*

### Performance

- Read every media's uses once per admin page, not once per media *(media)*

### Security

- The image runs on Debian 13, without the Debian 12 base's OpenSSL CVEs *(security)*

### Contributors

- fchaussin

## [0.7.1] - 2026-09-24

### Documentation

- My quizzes and the shared templates; the Docker Hub overview follows main *(screenshots)*
- New in 0.7, video and sound, right under the pitch *(readme)*

### Features

- One shared host account instead of a 5-minute seat *(demo)*

### Contributors

- fchaussin

## [0.7.0] - 2026-09-24

### ⚠️ Breaking changes

> [!WARNING]
> Read before upgrading.
> - **Sound files are no longer accepted. Audio could be attached to a question but no screen has ever played it, so it is refused at the door until that gets a proper design (#42). A quiz that already carries a sound keeps it in the database — nothing was deleted — but a bundle carrying one is refused as a whole, including a bundle exported from an older version. Sorry for the disruption if you were relying on it.**

### Bug Fixes

- The preload notice speaks of a tech-savvy participant *(console)*
- The preload notice names the real risk: a malicious participant *(console)*
- No pause button while the room waits for media *(console)*
- The lobby folds the address help and shares the link *(console)*
- A screen attaching at the reveal gets the session's audio target *(live)*
- The playback effect follows the position key it reads *(live)*
- The Markdown toolbar floats instead of pushing the field *(editor)*
- The sound unlock speaks of the session in Chinese, as the glossary does *(i18n)*
- The sweep spares a video or sound held outside a question slot *(media)*
- The description reads as a paragraph again *(editor)*
- A payload without a count is not a rating *(editor)*
- The reviews state really sits beside the switch *(editor)*
- A question resumed during its reading delay kept its full length *(game)*
- A taken copy starts its publication counter at zero (#39) *(store)*

### Documentation

- No version numbers ahead; finishing touches and hardening ship as patches *(roadmap)*
- The folded editor, the lobby with sound, joining in the room or remote *(screenshots)*
- V0.7.0 is video and sound; finishing touches and hardening move one step *(roadmap)*
- The folded editor, the lobby's sound first, upgrade examples at 0.7.0
- Listen first, the common start and the server clock
- Video, sound and remote participants, announced as experimental
- The last phase 4 error messages move to the idea box *(specs)*
- Phase 4 decisions on presence, default target and preloading *(specs)*
- Phase 4 brings remote players, preloading and media readiness *(specs)*
- Embedded videos move to the idea box *(specs)*
- A dedicated media brief, with microphone recording in the idea box *(specs)*
- Microphone recording moves to the backlog *(roadmap)*
- A dedicated guide for audio and video *(self-hosting)*
- Say plainly that sound files are suspended, and apologise *(media)*

### Features

- Who hears the sound comes first in the lobby settings *(console)*
- Every fold starts closed; the status bar keeps its card *(editor)*
- The status bar lines up with the title *(editor)*
- Sound settings on their own row, under the feedback *(editor)*
- Question media fold as one, visual and sound as groups *(editor)*
- Open, the sound settings read on one line *(editor)*
- Fold secondary settings, group each domain *(editor)*
- Listen first, then answer — the timer starts when the media ends *(media)*
- Every device starts a question's media on the same instant *(live)*
- Every screen reads the server's clock *(live)*
- The room waits a moment for the devices still loading a question's media *(live)*
- A playhead on the waveform, the same on every screen *(live)*
- Each question picks how thick its waveform is drawn *(editor)*
- The host sees which devices have loaded the next question's media *(live)*
- Every device fetches the next question's media ahead, from the lobby on *(live)*
- A remote participant's phone plays the question's video and sound *(live)*
- Each quiz, question and session says who hears the sound *(media)*
- A player says whether they play in the room or remotely *(live)*
- The projection asks for sound as soon as it opens *(live)*
- An interrupted media resumes a second early; the host can restart it *(live)*
- Each quiz picks the level its sounds play at *(media)*
- A question lasts as long as its media, plus a pause *(live)*
- Carry a question's video and sound (bundle version 3) *(bundle)*
- Play the question's video and sound on the projection *(live)*
- Pick an image or a video, and a sound, for a question *(editor)*
- Accept MP4 video and MP3 sound, checked by their content *(media)*
- Give a question a visual slot and an audio slot *(media)*
- Tell a media file by its bytes, not its name *(contracts)*
- Serve byte ranges so Safari can play a video *(media)*
- Each form bar says what it is saving *(editor)*
- An empty bank offers both ways to start *(dashboard)*
- Read a template as a grid, numbered and even (#39) *(store)*
- The samples live in the library instead of being handed out (#39) *(store)*
- A gallery of templates, and a preview to decide on (#39) *(store)*
- An account holds a set of roles, so managing and hosting cumulate *(auth)*
- The interface follows the roles, and an account has a page *(ui)*
- Admin manages the instance, it does not host it (RG-14) *(auth)*
- A page for running sessions, the menu is just the door *(live)*
- A top bar that fits a phone — logo only, burger below md *(ui)*
- The bank is a bank, and running sessions follow the host *(dashboard)*
- Accept images only until sound has somewhere to play (#42) *(media)*
- Alternative text, because the image is sometimes the question *(media)*
- Share a quiz as a template, browse and take copies (#39) *(store)*
- A catalogue of shared templates, on disk and offline (#39) *(store)*
- Hand a quiz over to another account with quiz:transfer *(cli)*

### Refactor

- A quiz description is plain text *(editor)*

### Contributors

- fchaussin

## [0.6.0] - 2026-09-22

### Bug Fixes

- The phone shows the nickname the server actually kept *(live)*
- Show the question image to participants and on the projection (#41) *(live)*
- The notice must not promise an account a guest does not have (#38) *(game)*

### Documentation

- Point the upgrade examples at 0.6.0
- The revision counter describes what the code does today *(specs)*
- No catalogue on a demo instance (#39) *(specs)*
- Write down how quizzes are shared, by copy (#39) *(specs)*
- Finish the guide split, specify roles and personalised tracking (#38)
- Split the operator guide, group the variables by theme *(self-hosting)*
- Translate the contributor docs, the ADRs and the specifications

### Features

- Link the project site from the demo limitations *(demo)*
- List on the home page what a demo instance does not do *(demo)*
- Add personalised tracking and the chosen display name (#38) *(game)*
- Authenticate participants too under AUTH_MODE=oidc (#38) *(auth)*
- Point OIDC_NAME_CLAIM at the claim carrying the display name (#38) *(auth)*
- Make `host` an assignable role, not only a derived one (#38) *(auth)*
- Take the header logo in any web format, add APP_LOGO_URL *(brand)*

### Refactor

- Stop exposing quiz.visibility, which describes nothing (#39) *(api)*

### Contributors

- fchaussin

## [0.5.1] - 2026-09-21

### Bug Fixes

- :latest no longer overwritten by the standalone image; non-root everywhere *(docker)*
- Prisma 7.10 drops hono/valibot, overrides for qs and body-parser *(deps)*
- Bake the schema engine matching the runtime so migrate works offline *(docker)*

### Documentation

- The standalone scan raises the npm alerts until the next release *(security)*
- Audit of the 48 code-scanning alerts — :latest was the standalone image *(security)*
- A 15-second GIF of a session on the big screen under the pitch *(readme)*
- One row of badges, main features first, local vs OIDC table, six screenshots *(readme)*
- Local mode vs OIDC mode among the features *(readme)*
- Link to the public demo instance *(readme)*

### Features

- Update tranditional chinese translations *(i18n)*

### Contributors

- fchaussin
- noeFly
- Francois Chaussin

## [0.5.0] - 2026-09-20

### Bug Fixes

- The admin CLI boots again — its context imports RedisModule *(cli)*
- Cap a seat taken before the guard at startup; local-mode hint no longer says demo *(demo)*
- A server install keeps the proxy-resolved origin as invitation address; remembered and LAN candidates only apply on localhost *(control)*
- Option removal confirmation checks the text only *(editor)*
- A quiz in play cannot be deleted; a session whose quiz vanished still ends; polls show no verdict *(live)*
- Screens attaching at a reveal get the question; option tiles pair up (container query on the wrapper); projection timer on one line; Resume vs Back to live *(live)*
- Help state declared before use *(control)*
- Sessions survive a server restart — timers re-armed from Redis, sockets re-attach on reconnect *(live)*
- One avatar everywhere — the server's seed once the game runs, podium rows keep it on reconnect *(live)*
- Accepted answers joined with a translated separator, not a hard-coded French 'ou' *(live)*
- Slides stretch to their container, halo is the design default *(live)*
- Resolve zh-TW straight to en, never through zh *(i18n)*
- Never provision an anonymous local identity, serve /config.js publicly *(auth)*
- Keep the OIDC session alive and log out at the provider *(auth)*

### Documentation

- Fix the Keycloak realm link; index and README mention the CLI quiz export / import
- Local mode and demo mode are two different things *(demo)*
- Phone views composed into landscape images — one format for every shot *(screenshots)*
- Editor after the status-bar rework *(screenshots)*
- Features, screenshots in journey order, scoring and live-session notes, config knobs
- Credit the zh-TW contributor in the glossary *(i18n)*
- Glossary — every interface term in the five locales, and the wording decisions *(i18n)*

### Features

- Quiz:list, quiz:export and quiz:import on the same services as the API (#20) *(cli)*
- The manifest carries the store fields (slug, revision, tags, license…) *(bundle)*
- The SPA learns of the demo from GET /auth/config, not config.js *(demo)*
- Public instance guards — 5-minute host seat, no uploads, hourly reset *(demo)*
- Running sessions of the quiz replace the single-session bar; options are removed with a trash icon and a confirmation *(editor)*
- Invitation address anticipates the runtime — bare LAN IPs composed with the page's scheme/port, environment-aware help, setups table in the docs *(control)*
- Help on the invitation address — why it matters and where to find the machine's IP *(control)*
- The host picks the invitation address (public URL, LAN IP, this page, or any address) *(live)*
- Show the project version (release tag) instead of the wire contract's *(frontend)*
- The reveal shows the answers with the participant's own pick (or typed / ordered answer) *(player)*
- URLs read like the interface; Tab cycles the console views; join fields autofocus *(routes)*
- Extend the host seat for a chosen duration, or release it, from the user menu *(auth)*
- Console / Projection / Participant tabs replace the breadcrumb *(control)*
- Ordering answers by drag and drop (pointer, touch, keyboard), arrows kept as fallback *(player)*
- Per-type scoring variants and a fixed points mode *(scoring)*
- Host seat countdown and renewal in the topbar *(auth)*
- Form edits follow the editor in a running session, substance stays frozen *(live)*
- Host navigates back over played steps (question reveals, slides) and resumes *(live)*
- Answer rules shown with the question on the projection and the phone *(live)*
- Text outline on by default for slides and questions
- Import a bundle from the dashboard, export from the editor *(frontend)*
- Portable bundle export / import (quiz.json + media/, zipped) *(quizzes)*
- Qd command inside both images *(cli)*
- Quizdock operator script (init, up, backup, restore, upgrade) + guide *(cli)*
- Admin CLI shipped in the image (doctor, seat, users, samples, purge) *(cli)*
- Make the local host seat an intentional, expiring claim *(auth)*
- Resolve the JWKS through OIDC discovery and stick to the standards *(auth)*
- Enforce the host role and add a zero-config local host seat *(auth)*

### Contributors

- Francois Chaussin
- fchaussin

## [0.4.2] - 2026-09-16

### Bug Fixes

- Zh-TW nickname typo (匿稱 → 暱稱) *(i18n)*

### Documentation

- Mention zh-TW in index.ts header and .env.example

### Features

- Add missing zh-TW keys (machine-assisted, native review welcome) *(i18n)*

### Contributors

- Francois Chaussin

## [0.4.1] - 2026-09-16

### Bug Fixes

- Load zh-TW dashboard namespace from the right folder *(i18n)*

### Documentation

- Add zh-TW as avaliable language in docs files

### Features

- Add zh-TW translations *(i18n)*
- Describe the selected question type's behaviour under the type select *(editor)*
- Navigation shells for host, participant and projection
- Document title per route ("<page> · <app name>") *(frontend)*
- Running-sessions badge on each quiz card *(dashboard)*
- Form drafts in localStorage, persistent nickname, capture confirm on the console
- Text block size — S 20 / M 30 / L 40 px on the stage *(slides)*

### Contributors

- Francois Chaussin
- noeFly

## [0.4.0] - 2026-09-16

### Bug Fixes

- Portal + fixed overlay instead of <dialog> top layer *(drawer)*
- Reopen modally after a hot reload, hide the grip on the side sheet *(drawer)*

### Documentation

- Absolute link in the upgrading note (Docker Hub renders the README) *(readme)*
- Upgrading procedure (auto migrations, backup, no rollback), engine knobs, release checklist
- README features cover slides, rich text, explanations, backgrounds; drop the stale Docker Hub overview copy
- Document the 0.x version bump rule *(release)*

### Features

- Confirm before deleting a question or a slide *(editor)*
- Status bar replaces the folded settings box *(editor)*
- Collapsible sequence rail and foldable slide preview *(editor)*
- Per-block text alignment, centred by default *(slides)*
- Backgrounds for slides and questions, gradient generator, column splits
- Block composer replaces title/body/layout *(slides)*
- Inline images, text contrast over covers, display-time semantics *(slides)*
- Layouts and full-surface rendering *(slides)*
- Master/detail builder, in-place title, option pairs, feedback page *(editor)*
- Drag-and-drop ordering, unsaved-edit guard, mobile drawer *(editor)*
- Content slides in the quiz sequence (quiz_item kind=slide)
- Per-question reveal delay in auto mode (question.reveal_delay_s)
- Answer explanation shown at reveal (question.answer_explanation)
- WYSIWYG editor for Markdown fields, with source toggle *(frontend)*
- Render restricted Markdown in text fields *(frontend)*

### Security

- Remediate transitive HIGH/CRITICAL CVEs, scan before audit gate *(security)*

### Contributors

- Francois Chaussin
- fchaussin

## [0.3.2] - 2026-06-24

### Security

- Remediate transitive CVEs + add Trivy/pnpm-audit scanning *(security)*

### Contributors

- fchaussin

## [0.3.1] - 2026-06-24

### Bug Fixes

- Exclude /config.js from OpenAPI (asset, not an API endpoint) *(api)*

### Documentation

- One-container (:standalone) quickstart + split user/integrator docs
- Detailed configuration, branding & OIDC guide
- Add join/avatar + player-review + podium shots; emoji-fixed; rating feature
- Add 1024x768 screenshots gallery to README
- Add a full badge row (release, CI, docker, stack, i18n) *(readme)*
- Add Docker Hub repository overview (ready to paste)

### Features

- All-in-one :standalone image (one-command beginner use) *(deploy)*

### Contributors

- fchaussin

## [0.3.0] - 2026-06-24

### Bug Fixes

- Block answering during the read delay so every answer counts *(player)*
- Center modal ConfirmDialog *(ui)*
- Enable Vite polling so WSL2 bind-mount edits hot-reload *(dev)*
- Stop Questions overlapping the sidebar on desktop *(editor)*
- Hoist Questions above Diffusion/Avis on small screens, stop horizontal overflow *(editor)*
- Tooltip no longer sticks after click; hover-delay + keyboard-only focus *(ui)*
- Rating no longer hangs on a missing ack; backend tsc watch polling
- Manuel/auto tooltips were clipped; add Démarrer tooltip *(control)*
- Editor 2-col layout was clipped by the shell width cap *(frontend)*
- Freeze the countdown on pause across all three surfaces *(frontend)*
- Reveal lisible pour ordre/texte (intitulés, valeurs acceptées) *(frontend)*
- Écran joueur — énoncé, chrono, multi-réponses, types numérique/texte/ordre *(frontend)*
- Join joueur sur le socket du hook (pas un 2ᵉ socket) *(frontend)*
- Convergence REVEAL sur les connectés en attente, pas hlen(réponses) *(game)*

### Documentation

- Docker hub run instructions (pull image) + build option
- Add Multiavatar player avatars feature *(readme)*
- Rewrite for GitHub + Docker Hub; logo, features, self-host *(readme)*
- Clarify registry/namespace (Docker Hub account vs GHCR alt) *(releasing)*
- Add RELEASING.md (Docker Hub publishing plan)
- Site is live at quizdock.github.io *(brand)*
- Add brand & hosting notes (surfaces, GitHub Pages, org reservation) *(brand)*
- I18n plan + canonical glossary (session/participant/animateur) *(adr)*
- Cadrage de la partie live + avatar au backlog *(specs)*
- Changelog — boucle de jeu complète + partage PIN/QR (v0.3.0 en cours)
- Changelog — scoring + session create/join + ports 1xxxx (v0.3.0 en cours)

### Features

- Real QuizDock icon as default app logo; show app name in header *(brand)*
- Single all-in-one image (NestJS serves the SPA) *(deploy)*
- Add English, Spanish & Simplified Chinese; env-driven instance language *(i18n)*
- Rename live-quizz -> QuizDock *(brand)*
- Rename roux-quizz -> live-quizz + runtime white-label *(brand)*
- Wire per-field validation translation (honor structured codes) *(i18n)*
- Phase 3 — backend emits only tokens, front owns the dictionary *(i18n)*
- Phase 2 — extract all UI strings + apply glossary *(i18n)*
- Phase 2 — extract dashboard + confirm-dialog, apply glossary *(i18n)*
- Phase 1 — synchronous i18next infra (react-i18next, FR) *(i18n)*
- Score-bar ranking list at reveal (top 10), podium kept for the end *(live)*
- Icon-only save button for the avatar *(avatar)*
- Randomizable, persisted player avatars propagated live *(avatar)*
- Host can ban a player for a duration (RG-12) *(game)*
- Standings between questions, final ranking, player rank + avatars *(live)*
- Sticky-bottom join QR + PIN during phone-answer questions *(screen)*
- Full-capture consent toggle in the lobby before start (SFD 3.1) *(game)*
- Per-participant drill-down + CSV exports (phase 3) *(sessions)*
- Owner-only history of archived games (phase 2 — consultation) *(sessions)*
- Archive finished sessions with results (phase 1 — capture) *(game)*
- Enlarge result/end icons, sticky-bottom answer zone with scrollable prompt *(player)*
- Guard end-game with warning + confirm modal, expose pause during a live question *(control)*
- Textarea prompts, responsive sidebar, scrollable feedback, relocated delete *(editor)*
- Auto-advance countdown + progress bar on the reveal *(control)*
- Show the correct answer (green outline) to the host live *(control)*
- Prominent current-question panel during a live question *(control)*
- Stop a game from the dashboard list and the control lobby *(game)*
- End-of-game rating UI — player stars + owner Avis card *(frontend)*
- End-of-game player rating (Likert + comment), owner-only read *(feedback)*
- Quiz title + description in recap, tooltips on actions/QR *(control)*
- Editor desktop layout — settings sidebar + questions main *(frontend)*
- Control console as a pacing dashboard (mode/pause/chrono/outline) *(frontend)*
- Manual/auto pacing, pause, live chrono adjust + control outline *(game)*
- Bouton « Présenter » en vert (variante success) *(frontend)*
- Éditeur — « Enregistrer » réactif au dirty + modal de confirmation custom *(frontend)*
- Builder réorganisé + panneau d'accès (contrôle/projection/invitation) *(frontend)*
- Endpoint REST GET /games/mine + panneau « parties en cours » (§6.2) *(game)*
- Écrans live — console hôte, projeté, client apprenant (§10.3) *(frontend)*
- Fondation live client — socket dédoublonné, hook d'état, chrono *(frontend)*
- Replay complet à l'attache — roster du lobby + answer:count courant *(game)*
- Hôte déconnecté — pause HOST_DISCONNECTED, reprise et fin auto (§7) *(game)*
- Sémantique live de rattachement — late join, spectateur, reconnexion, host:attach *(game)*
- Message de partage enrichi (PIN + lien cliquable) ; docs à jour *(frontend)*
- Home rejoindre fonctionnel, /join en Card, bouton Partager (PIN+QR) *(frontend)*
- Partage de partie par PIN + QR code depuis l'éditeur et la liste (P3-FRONT-1) *(frontend)*
- Reveal personnel + leaderboard + host:reveal/next/end + podium (P3-BACK-7/8) *(game)*
- Player:submit — timing serveur, unicité, scoring branché (P3-BACK-5) *(game)*
- Machine à états — host:start, question:start, timer→reveal atomique (P3-BACK-4/5) *(game)*
- Série neutre sur questions sans points + filtre WS error typé *(game)*
- Session create + join sur état Redis (P3-BACK-2/3) *(game)*
- Fonction de scoring pure + grading par type + golden tests 100% (P3-BACK-6) *(game)*
- Fondation temps réel — gateway Socket.IO /game + Redis + contrat WS typé (P3-BACK-1) *(game)*

### Refactor

- De-specialize education vocabulary -> generic *(brand)*
- Semantic color tokens over Bootstrap-style "success" *(frontend)*

### Contributors

- fchaussin

## [0.2.0] - 2026-06-12

### Documentation

- Changelog v0.2.0 (Builder + Auth)

### Features

- Flux de connexion OIDC (Authorization Code + PKCE) (P2-FRONT-1) *(frontend)*
- Endpoint public GET /auth/config (découverte du mode par la SPA) *(auth)*
- Intègre les icônes lucide-react (+ specs) *(frontend)*
- Plein écran + responsive sur l'aperçu (fondation live v0.3.0) *(frontend)*
- Passe UI shadcn/ui + Tailwind v4 *(frontend)*
- Réordonnancement des questions dans l'éditeur *(frontend)*
- Upload média dans le formulaire de question *(frontend)*
- Bouton Aperçu → prévisualisation du quiz en nouvel onglet (P2-FRONT-4) *(frontend)*
- Formulaire de question par type (ajout/édition) (P2-FRONT-3) *(frontend)*
- Shell de l'éditeur de quiz — méta, cycle de vie, liste (P2-FRONT-3) *(frontend)*
- Fondation builder — router, auth locale, tableau de bord (P2-FRONT-1) *(frontend)*
- Upload sur volume local servi par le backend (P2-BACK-5) *(media)*
- Endpoint de duplication de quiz (P2-BACK-2) *(quizzes)*
- Endpoints CRUD questions/options + validation par type (P2-BACK-3/4) *(questions)*
- Endpoints CRUD quiz + cycle de vie + validation Zod (P2-BACK-2/6) *(quizzes)*
- Abstraction AuthProvider (none/keycloak) + guard + provisioning (P1-BACK-3) *(auth)*

### Refactor

- Généralise Keycloak → OIDC (specs + code + schéma) *(auth)*

### Contributors

- fchaussin

## [0.1.2] - 2026-06-10

### Features

- Schéma Prisma, migrations et PrismaService (P1-DATA-1) *(data)*

### Contributors

- fchaussin

## [0.1.1] - 2026-06-09

### Documentation

- Changelog 0.1.1 (outillage des fondations)

### Features

- Génère l'OpenAPI et le client REST Orval (TanStack Query) *(api)*

### Contributors

- fchaussin

## [0.1.0] - 2026-06-09

### Bug Fixes

- Rendre la stack opérationnelle (dev + prod) vérifiée end-to-end *(docker)*

### Documentation

- Changelog v0.1.0 (fondations)
- Spécifications de référence et organisation du dépôt

### Features

- Squelette React + Vite avec page d'accueil *(frontend)*
- Squelette NestJS avec /health et OpenAPI *(backend)*
- Package partagé d'énumérations et d'événements WS (dual ESM/CJS) *(contracts)*

### Contributors

- fchaussin


