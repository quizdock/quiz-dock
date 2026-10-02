# Administration

What an administrator (the `admin` role) does to the instance, from the web or
from the command line — and what the operator allows the web to do.

- [1. Three domains](#1-three-domains)
- [2. The web administration](#2-the-web-administration)
- [3. What the web may change](#3-what-the-web-may-change)
- [4. The audit](#4-the-audit)
- [5. From the command line](#5-from-the-command-line)
- [6. The setup of a fresh instance](#6-the-setup-of-a-fresh-instance)

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
went wrong; `qd settings.reset --all` removes them from a shell.
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

## 6. The setup of a fresh instance

A fresh instance — no account yet — offers a **setup wizard** in the browser:
the home page links to it (`/setup`). What the container needs before it starts
(database, Redis, `AUTH_MODE`, ports, volumes) is set before, by
`quizdock init` or in `.env`; the wizard shows it, read-only.

**Who may run it.** Whoever reaches a fresh instance must not own it: at start,
the backend writes a **setup token** in its logs (`docker compose logs quizdock`,
or `docker logs quizdock`), valid a day, single use; `qd setup.token` gives a new
one. With OIDC, the wizard also needs a signed-in account, and the administrator
role from the provider to finish. Ten wrong tokens from one address make it wait
a quarter of an hour.

**Steps** — health (the checks of `qd doctor`: what fails is fixed in `.env`),
identity (name, language, logo, feedback links), address (the public address,
the local network addresses, and a test from a phone), access (the
authentication mode as set; with OIDC, open access for participants; in local
mode, the first administrator's name), limits and pace (a preset, or a value at
a time), content (the sample quizzes for a host's bank), summary (what is set,
and from where; a `.env` excerpt to pin it), *Finish*. The wizard sets the levels
C2 to C4 whatever `ADMIN_WEB_SCOPE` says — it runs once, under the token —, never
a variable `ADMIN_LOCK` names, never a C1. Every change is audited.

**The phone test.** The server cannot tell whether a phone reaches it: for each
candidate address the wizard shows a QR code to a test page; opened from a phone
— on the guests' Wi-Fi or on mobile data, as a participant would be —, it marks
the address as reached, and the host console then offers it first. When it fails,
the wizard lists the usual causes (another network, isolated guests, a firewall,
a public address without its name or port, Docker Desktop's bridge).

**Once finished**, the wizard is closed for good; `qd setup.reopen` opens it
again (from a shell only), with a new token. An automated deployment skips it
with `qd setup.complete`; an instance already in use when it is upgraded is
considered set up.

