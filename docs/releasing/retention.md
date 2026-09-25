# Docker Hub image retention policy

Status: **proposal**. Repository: `fchaussin/quizdock` (classic image and standalone image).

## 1. Goal

Keep on Docker Hub whatever someone still uses to install, upgrade or roll back, and remove the rest automatically, without ever breaking a tag that is still useful.

Starting point, the manual clean-up of 2026-09-25: 31 tags and 25 indexes (2 of them already untagged), 7.2 GB. After the clean-up: 20 tags and 12 indexes, 4.3 GB.

## 2. Vocabulary

- **Minor line** `X.Y`: all the `X.Y.*` versions.
- **Tag set of a version** `X.Y.Z`: `X.Y.Z` and `standalone-X.Y.Z`. They are always handled together.
- **Floating tags**: `latest`, `standalone`, `X.Y` (and `standalone-X.Y`, see section 7). Every release moves them.
- **Current version of a line**: the highest patch version published in that line.
- **Superseded version**: any version of a line that is not its current version.
- **Orphan**: an index with no tag left, together with its images and attestations.

## 3. Rules

The rules apply in order. The first one that applies decides.

### R1. Protected tags: never deleted

- `latest`, `standalone`.
- Every floating tag `X.Y` and `standalone-X.Y` of the lines kept (R3).
- The tag set of the current version of each line kept.
- Any tag pointing to the same digest as a protected tag.

### R2. Superseded versions: deleted after a grace period

The tag set of a superseded version is deleted **14 days** after the version that supersedes it is published.

Why the delay: if `0.8.1` is broken, `0.8.0` is the natural rollback. It must stay available long enough for the problem to show.

Example: `0.8.1` is published on October 1st, so `0.8.0` and `standalone-0.8.0` are deleted from October 15th on.

### R3. Old minor lines: retired only when abandoned

A whole line `X.Y`, floating tags included, is retired when **all three conditions** hold:

1. It is not one of the **3 most recent lines**.
2. Its current version was published more than **180 days** ago.
3. None of its tags has been pulled for **90 days** (`tag_last_pulled` field of the API).

Why: an old line that is still pulled serves someone (an instance not upgraded yet, a database migration with no way back as in 0.4). Age alone would break those users. Usage alone would never trigger on a recent, little-used line.

As things stand, no line would be retired. Line 0.3 (published 3 months ago) will meet condition 2 around the end of December 2026.

### R4. Unknown tags: never touched

Any tag that matches none of `X.Y.Z`, `X.Y`, `standalone-X.Y.Z`, `standalone-X.Y`, `latest` or `standalone` is ignored and listed in the report, for example `sha-…`, `rc`, `test`. Only what can be interpreted is deleted.

### R5. Orphans: purged after 7 days

An index untagged for more than **7 days** is deleted with its images and attestations, provided none of these images is referenced by a remaining tag.

Why: every release moves the floating tags, which leaves orphans behind. The delay leaves time to recover a digest if needed.

## 4. Safeguards

- **Dry run by default**: a manual run prints the plan and deletes nothing. Actual deletion requires `dry_run: false`.
- **Cap**: at most **10 tags** deleted per run. Above that, the job fails without deleting anything and asks for a manual run.
- **Consistency check before deleting**: the job fails without deleting anything if one of the expected protected tags (R1) is missing from the registry. A registry in an unexpected state must not be cleaned.
- **Consistency with GitHub**: a version counts as current only if the matching GitHub release `vX.Y.Z` exists. A Docker tag with no release is reported, not deleted.
- **Log**: every run writes to the job summary the tags kept, deleted and ignored, with their digest and the rule applied.

## 5. Triggers

- **Scheduled**: every Monday (cron), for real.
- **Manual**: `workflow_dispatch`, dry run by default.
- **Not on every release**: the delays of R2 and R5 make a run at release time useless. A separate job also keeps a failed clean-up from marking a release as failed.

Rollout: the first 4 scheduled runs are dry runs. Real mode starts once their reports have been reviewed.

## 6. Implementation

- A new workflow, `.github/workflows/retention.yml`, independent of `release.yml`.
- A new secret, `DOCKERHUB_DELETE_TOKEN`: a personal access token with the Read, Write, Delete permission. The current `DOCKERHUB_TOKEN` (Read & Write) is not enough and must not get more rights, since the builds use it.
- Reading the state: `GET /v2/namespaces/fchaussin/repositories/quizdock/tags` (documented endpoint, gives the digest, the images and `tag_last_pulled`).
- Deleting a tag: `DELETE /v2/repositories/fchaussin/quizdock/tags/{tag}/`. Many scripts use this endpoint, but it is **missing from the official reference**. It must be tried on a test tag before going live.
- Purging orphans (R5): **no documented public endpoint** so far. Until there is one, R5 is applied by hand from the Image Management tab once a month, and the job only lists the orphans in its report.

## 7. Related: `standalone-X.Y` tags

The classic image has `X.Y` tags, the standalone image does not. Proposal: add `type=semver,pattern=standalone-{{major}}.{{minor}}` to the `standalone` job of `release.yml`. This is independent of retention, but R1 and R3 already account for it.

## 8. Acceptance criteria

| Scenario | Expected result |
|---|---|
| `0.8.1` is published | Nothing deleted that day. `0.8.0` and `standalone-0.8.0` deleted by the first run after day 14. `0.8`, `latest` and `standalone` point to 0.8.1. |
| `0.9.0` is published | Nothing deleted in line 0.8 (its current version stays protected). Line 0.6 leaves the 3 most recent, but is retired only if R3.2 and R3.3 hold. |
| The `v0.8.1` release is re-run | The tags are pushed again, the old index becomes an orphan and is listed (R5), nothing else changes. |
| A `sha-abc123` tag exists | Ignored, listed in the report (R4). |
| `latest` is missing from the registry | The job fails without deleting anything. |
| 12 tags to delete | The job fails without deleting anything (cap). |
| Line 0.3 pulled 20 days ago, published 200 days ago | Kept (R3.3). |

## 9. Parameters

| Parameter | Value | Rule |
|---|---|---|
| Grace period of a superseded version | 14 days | R2 |
| Minor lines always kept | 3 | R3 |
| Minimum age to retire a line | 180 days | R3 |
| No pull for this long to retire a line | 90 days | R3 |
| Delay before purging an orphan | 7 days | R5 |
| Deletions cap per run | 10 tags | Safeguards |
