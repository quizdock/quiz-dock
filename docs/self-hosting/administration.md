# Administration

What an administrator (the `admin` role) does to the instance, from the web or
from the command line — and what the operator allows the web to do.

- [1. Three domains](#1-three-domains)
- [2. The web administration](#2-the-web-administration)
- [3. What the web may change](#3-what-the-web-may-change)
- [4. The audit](#4-the-audit)
- [5. From the command line](#5-from-the-command-line)

## 1. Three domains

| Domain | What | From the web |
|---|---|---|
| **Instance** | settings and presets, accounts and roles, the host seat, health, the audit | read always; changed only with `ADMIN_WEB_SCOPE=write` |
| **Quizzes** | every quiz and its sessions, whoever owns them: hand one over, export, import for a host, archive, restore, delete, find the ones nobody can reach, purge old sessions | the `admin` role |
| **Media** | the instance's shared media library | the `admin` role |

The role comes from the identity provider's claims (OIDC) or from
`qd user:set-role` ([CLI](cli.md)).

## 2. The web administration

*Administration* in the account menu (administrators only), one section per
domain:

- **Settings** — every variable the application reads: its value (in megabytes
  and seconds, whatever unit the variable is written in; a secret only as *set*
  or *not set*), where it comes from (*default*, *.env*, *changed here*), its level (C1–C4),
  when a change applies, why it cannot be changed here, the problems found at
  start, and its help — what it does, what it accepts, an example, the variables
  that go with it, the documentation, its last changes. Three layouts of the
  same rows: cards, list and detail, table; a search and filters above them.
  The variables read outside the application (Compose, the `quizdock` script,
  Keycloak) are listed below, read-only.

  Where the scope allows, each row has its control — a switch, a list, a number
  in its unit with its range, an editable list —, checked as it is typed and
  saved explicitly; a level C2 change is confirmed. A value changed here wins
  over `.env` (default < `.env` < administration): the row shows the `.env` value
  it replaces, and *Back to .env* takes it back. *Export as .env* gives every
  change as a `.env` excerpt — to pin them in `.env`, or move them to another
  instance —, *Take everything back* removes them all.
- **Presets**, above the settings — ready-made values on three independent axes:
  *pace* (fast, standard, comfortable: the reading time, the automatic mode, the
  pause once everyone answered), *venue* (standard, large event, modest
  equipment: the wait for media, the transitions, the largest video) and
  *audience* (accounts required or open to all — OIDC only). The named presets
  (party, classroom, large event, express quiz, accessible) are shortcuts to
  levels. A preset is previewed — each variable, from what to what — before it
  is applied, all at once; a variable locked by `ADMIN_LOCK` is left alone and
  said so.
- **Health** — the checks of `qd doctor` and the state of the migrations.
- **Accounts** — the accounts and their roles, granting or revoking one, the
  local mode's host seat.
- **Audit** — every administrative action (below).
- **Quizzes** — every quiz of the instance: the operations `qd` had alone, and
  archiving, restoring or deleting someone's quiz (the confirmation names the
  quiz and its owner: export it first), the quizzes whose owner can no longer
  reach them.
- **Media** — the instance's media library ([unchanged](#1-three-domains)).

A form is generated for each operation; one that destroys asks for a
confirmation, one that can says first what it would do (*Preview*).

## 3. What the web may change

| Variable | Effect |
|---|---|
| `ADMIN_WEB_SCOPE` | `read` (default): the web shows the Instance domain and changes nothing in it. `write`: administrators may change it — critical changes and destructive operations confirmed. Quizzes and media are not concerned. |
| `ADMIN_LOCK` | Variables the web never changes, whatever the scope (`APP_NAME,MEDIA_MAX_VIDEO_MB`). |
| `ADMIN_TOKEN` | **Local mode** (`AUTH_MODE=none`) has no accounts: anyone who reaches the instance could claim a name. There, the web changes nothing in the Instance and Quizzes domains unless this token is set, and asks for it (kept in the browser tab only). 32 characters or more. |

These live in `.env` only — never changed from the web — and apply at restart.
`ADMIN_OVERRIDES=ignore` starts the instance on `.env` alone: every value changed
from the administration is ignored (kept, not deleted) — the way back when one
went wrong; `qd settings.reset --all=true` removes them from a shell.
A critical variable (level C1: start-up, data, security) is never changed from
the web. Too many wrong tokens from one address make it wait a quarter of an
hour.

## 4. The audit

Every change — from the web or from the command line — and every refusal is
kept: when, who, through what (and from which address), the operation and its
parameters (secrets masked), what it replaced, how it ended. Nothing edits or deletes it; it is
backed up with the database. Read it in *Administration → Audit*, or with
`qd audit.list`.

## 5. From the command line

Every operation of the web is one of `qd` too, never gated by
`ADMIN_WEB_SCOPE`: a shell in the container already holds every right. See
[CLI → operations](cli.md#operations).
