# QuizDock — Community store (the store brief)

> The plan for the community catalogue of quiz templates ([#21](https://github.com/quizdock/quiz-dock/issues/21)):
> the model, the decisions taken, what is delivered, and the ordered list of what remains before the store opens.
> How the store works inside (formats, CI, publication tool) is specified in
> [quiz-store's SPECIFICATION.md](https://github.com/quizdock/quiz-store/blob/main/SPECIFICATION.md); this document
> keeps the QuizDock side and the road to opening.

Status: **in preparation.** The two store repositories exist and publish, nothing points users to them yet.

---

## 1. The model

- **QuizDock is the reference.** The bundle format, its JSON Schema and its versions are defined here and only here.
- **The store is an optional satellite.** It depends on QuizDock, never the other way around. An instance without it,
  offline included (#31), loses nothing: the internal template catalogue (#39) stays the main way to share.
- **Authors host their own quizzes**, as in Obsidian community plugins or Homebrew taps. Each author has one
  repository created from the template [`quizdock/quizdock-quizzes`](https://github.com/quizdock/quizdock-quizzes)
  and keeps that name. It holds as many quizzes as they like, **one folder per quiz** (an unzipped *Export for
  publication*). The release of that repository builds the zips and an `index.json`.
- **The store is a registry of sources**: [`quizdock/quiz-store`](https://github.com/quizdock/quiz-store) lists
  index URLs. A maintainer reviews each source once, from a registration form; reports and removal are the
  safeguard afterwards.
- **Identity**: `<forge host>/<vendor>/<slug>` (`github.com/alice/world-capitals`), built by the store from the
  platform and the bundle `slug`. It only appears in `index.json`.
- **Clonable**: an organisation can run a closed store on another forge or a plain web server. Nothing refers to
  `quizdock` or to GitHub URL patterns.
- **Copy, never reference** (RG-17): an imported quiz is an independent draft that carries nothing of its origin.

---

## 2. What is delivered

| Piece | Where | Status |
|---|---|---|
| Licence (CC0 / CC BY / CC BY-SA) and tags in the quiz settings | #80 | On `dev` |
| Import bounded on the bytes actually unpacked; slug reset on import | #81 | On `dev` |
| Bundle JSON Schema, one file per manifest version (`schema/quiz-bundle.v3.json`) | #84 | On `dev` |
| Quiz language: instance language by default, editable | #86 (closes #83) | On `dev` |
| *Export for publication* (checks, slug confirmation, `PUBLICATION_MAX_MB`) | #87 | On `dev` |
| A manager reads another host's quiz; failed saves say so | #90 (closes #82), tests #91 | On `dev` / PR |
| Store spec, guide, self-hosting guide, empty registry | quiz-store | Published |
| Publication CLI and action (folders → reproducible zips + index, rolling release) | quiz-store #1–#3 | Published, tagged `v1.0.0` / `v1` |
| Registration form (label `registration`) and review procedure | quiz-store #4 | Published |
| Author template (folders, workflow at `@v1`) | quizdock-quizzes #1–#2 | Published, marked as template |
| End-to-end test with real exports | `fchaussin/quizdock-quizzes-test` (private, kept) | Passed |

The end-to-end test checked: the first run starts by itself, `contents: write` is enough for the release, a real
export publishes, the rebuilt zip weighs exactly what QuizDock exported, an unchanged quiz is not uploaded again, an
invalid quiz is annotated without blocking the others, and the zip from the release imports back into QuizDock.

---

## 3. Decisions taken

- **Imitate a proven model, never invent one.** Every choice cites its precedent (Obsidian, Helm / Artifact Hub,
  Homebrew taps, Go / Terraform naming, GitHub Actions versioning).
- **The contributor does not know git.** Web-only path, a guide on one screen; if a step needs explaining, the
  step is wrong.
- **Quizzes are stored as folders, zips are built by the release.** Git diffs `quiz.json` as text and stores an
  unchanged media file once. A zip dropped into `quizzes/` is refused with "unzip it and upload the folder".
- **The slug is the quiz's identity in its repository**, confirmed at every publication export, never frozen, no
  publication state on the quiz. Two folders with one slug: the tool publishes neither and explains both cases.
- **Licences**: the quiz settings offer only CC0, CC BY and CC BY-SA, the three the store accepts.
- **Credits are the contributor's responsibility**: a media without a credit is a warning, never a refusal; the
  guide points to reliable open sources.
- **Size**: 20 MB per quiz by default (`PUBLICATION_MAX_MB` in QuizDock, `max-mb` in the action), a store rule
  rather than a format rule.
- **Inbound flow under a whitelist** (QuizDock side, not built yet): `QUIZ_STORE_URL` lists the allowed registries;
  emptying it closes the flow.
- **A manager sees every quiz but changes none** (RG-14); whether other hosts may have a quiz stays the owner's call,
  by sharing it as a template (RG-17). No copy from the manager's read-only view.
- **Versions of the action**: authors use `@v1`. A compatible fix is tagged `v1.0.x` and `v1` moves to it; a
  breaking change is `v2`. Tags are set with the maintainer's agreement only.
- **Kept out of the README and Docker Hub**: no warning banners; upgrade notes live in the changelog, the release
  notes and the upgrade guide.

---

## 4. The road to opening

Ordered: each step makes the next one meaningful.

### 4.1 A QuizDock release with the prerequisites

With the released QuizDock, an author cannot set a licence: the store would refuse every quiz. Nothing opens before
a release carries what is on `dev`.

- [ ] Release `dev` into `main`: #80, #81, #84, #86, #87, #90 (and #91).
- [ ] The release publishes `schema/quiz-bundle.v3.json` on `main`, at its tag.
- [ ] quiz-store pins the schema at that tag instead of its copy, with a check that the two stay identical
  (`publish-action/schema/SOURCE.md`); a `v1.0.x` of the action if anything changes.

### 4.2 The store page in QuizDock

Without it, a published quiz appears nowhere for users, and a contributor has no reason to publish.

- [ ] `QUIZ_STORE_URL`: a whitelist of registry URLs, the official registry by default, **empty closes the flow**
  (no page, no outgoing request). Provenance shown on every entry.
- [ ] Fetch safety: server-side only; allowed hosts are the registries' plus the ones the administrator lists (GitHub
  release downloads redirect to a separate asset host); every redirect checked against the same list; private and
  loopback addresses refused (SSRF against the Docker network).
- [ ] Import: download the zip, check its `sha256` against the index, then the existing importer (new draft of the
  importer, own media, slug reset, archive limits).
- [ ] The page: the catalogue with filters by language and tags, licence and author shown, a preview, *Take a copy*,
  and a *Report* link to the source's issue tracker.
- [ ] Documented for operators in `docs/self-hosting/` (the whitelist, the hosts, how to close the flow, how to
  point at a closed store).

### 4.3 Checks with a brand-new GitHub account

Only a real new account can tell (the maintainer runs them):

- [ ] Dragging a folder, with its `media/` sub-folder, onto *Upload files* keeps its structure, in the common
  browsers. **The key step of the guide.**
- [ ] Whether two-factor authentication is required at once or after a grace period, for an account that pushes.
- [ ] After sign-up, GitHub brings the user back to the page they came from.
- [ ] Whether *Use this template* proposes the template's name or leaves it empty (the guide assumes the author
  types `quizdock-quizzes`).

Each answer updates the guide (`CONTRIBUTING.md`) and the ticked list in quiz-store's specification.

### 4.4 Opening

- [ ] Remove "submissions are not open yet" from quiz-store's README and guide.
- [ ] Post the rewritten text of #21: the model, the contract between the repositories (the JSON Schema), the
  app-side list.
- [ ] Seed the registry with the sample quizzes (CC BY), published from a repository of the project, so the
  catalogue is not empty on day one.
- [ ] Mention the store on the website and in the README, as what a host gains (no protocol names there).

### 4.5 After opening

- [ ] Robustness at scale: a repository with many quizzes, quizzes near 20 MB, GitHub API limits on assets.
- [ ] Practise the review procedure on the first registrations and adjust the form.
- [ ] Watch the load of moderation: one maintainer for now.

---

## 5. Out of scope for now

- Authenticated registries or sources (a token per source).
- Signed indexes.
- Editorial curation, ratings.
- A *Publish* button in QuizDock that pushes to the author's repository.
- Update hints on imported copies (a copy carries nothing of its origin, by design).
