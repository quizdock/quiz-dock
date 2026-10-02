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
| **Instance** | settings, accounts and roles, the host seat, health, the audit | read always; changed only with `ADMIN_WEB_SCOPE=write` |
| **Quizzes** | every quiz and its sessions, whoever owns them: hand one over, export, import for a host, purge old sessions | the `admin` role |
| **Media** | the instance's shared media library | the `admin` role |

The role comes from the identity provider's claims (OIDC) or from
`qd user:set-role` ([CLI](cli.md)).

## 2. The web administration

*Administration* in the account menu (administrators only), one section per
domain:

- **Settings** — every variable the application reads: its value (in megabytes
  and seconds, whatever unit the variable is written in; a secret only as *set*
  or *not set*), where it comes from (*default*, *.env*), its level (C1–C4),
  when a change applies, why it cannot be changed here, the problems found at
  start, and its help — what it does, what it accepts, an example, the variables
  that go with it, the documentation, its last changes. Three layouts of the
  same rows: cards, list and detail, table; a search and filters above them.
  The variables read outside the application (Compose, the `quizdock` script,
  Keycloak) are listed below, read-only.
- **Health** — the checks of `qd doctor` and the state of the migrations.
- **Accounts** — the accounts and their roles, granting or revoking one, the
  local mode's host seat.
- **Audit** — every administrative action (below).
- **Quizzes** — every quiz of the instance; the operations `qd` had alone.
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
A critical variable (level C1: start-up, data, security) is never changed from
the web. Too many wrong tokens from one address make it wait a quarter of an
hour.

## 4. The audit

Every change — from the web or from the command line — and every refusal is
kept: when, who, through what (and from which address), the operation and its
parameters (secrets masked), how it ended. Nothing edits or deletes it; it is
backed up with the database. Read it in *Administration → Audit*, or with
`qd audit.list`.

## 5. From the command line

Every operation of the web is one of `qd` too, never gated by
`ADMIN_WEB_SCOPE`: a shell in the container already holds every right. See
[CLI → operations](cli.md#operations).
