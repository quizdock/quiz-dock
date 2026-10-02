# CLI — install, maintain, administer

Two tools, one name, for operators who self-host QuizDock:

| | Where it runs | What it does |
|---|---|---|
| **`quizdock`** script | on the host (needs only Docker + curl) | install, start/stop, logs, backup/restore, upgrade — and relays admin commands |
| **`qd`** command in the image | inside the app container | doctor, host seat, users, sample quizzes, quiz export / import, retention purge |

You normally only touch the first one.

- [1. The `quizdock` script](#1-the-quizdock-script)
- [2. Admin commands (in-image CLI)](#2-admin-commands-in-image-cli)
- [3. Recipes](#3-recipes)

---

## 1. The `quizdock` script

```bash
curl -fsSLO https://raw.githubusercontent.com/quizdock/quiz-dock/main/quizdock
chmod +x quizdock
./quizdock init            # guided: name, language, port, auth mode → writes .env, fetches docker-compose.prod.yml
./quizdock up              # starts the stack and waits for /health
```

`init --standalone` targets the all-in-one image instead (one container, bundled
PostgreSQL + Redis, data in the `quizdock` volume) — fine for a demo, not for
production. The mode is remembered in `.env` (`QUIZDOCK_MODE`), everything else
reads the same file.
`init --full` adds a bundled Keycloak and creates random temporary passwords for
its sample users and admin. See [choose a setup](setups.md).

| Command | Description |
|---|---|
| `init [--full\|--standalone]` | Create `.env` (guided; generates passwords) and fetch Compose plus the realm file when needed. |
| `up` / `down` | Start (and wait for health) / stop. |
| `status` | Containers and health check. |
| `logs [service]` | Follow logs (`quizdock`, `postgres`, `redis`, `migrate` in compose mode). |
| `backup [dir]` | `pg_dump --clean` + media + `.env` → `./backups/quizdock-<date>/`; full mode also dumps the Keycloak database. |
| `restore <dir>` | Replace the database and media from a backup (stops the app first; asks for confirmation). |
| `upgrade [tag]` | **backup → pull → restart** (migrations run on start) **→ doctor**. Persists the tag in `.env`. |
| `doctor`, `seat:*`, `user:*`, `samples:load`, `quiz:list`, `sessions:purge` | Relayed to the in-image CLI (below). |
| `quiz:export <id> <file.zip>` | Write a quiz bundle to a file **on the host** (streamed out of the container). |
| `quiz:import <file> <sub\|email>` | Create a draft in that user's bank from a bundle file on the host. |
| `qd <operation> …` | Any administrative operation ([below](#operations)). |
| `admin <cmd…>` | Relay anything else (`admin help`). |

Overrides: `QUIZDOCK_IMAGE`, `QUIZDOCK_COMPOSE_FILE`, `QUIZDOCK_ENV_FILE`,
`QUIZDOCK_BACKUP_DIR`, `QUIZDOCK_CONTAINER` (standalone container name).

## 2. Admin commands (in-image CLI)

Available through `./quizdock <command>`, or directly:

```bash
# compose
docker compose -f docker-compose.prod.yml exec quizdock qd doctor
# standalone
docker exec quizdock qd doctor
```

(`qd` is `/usr/local/bin/qd` in both images — a launcher for `node dist/cli.js`,
which still works too.)

| Command | Description |
|---|---|
| `doctor` | Lists every configuration value it cannot read or that falls outside its range, and the settings that contradict each other (the same warnings the backend logs at start); checks PostgreSQL, applied / pending / failed migrations, Redis, that `MEDIA_DIR` and `STORE_DIR` are writable, and in OIDC mode fetches the discovery document and the JWKS. Exit code 1 when something fails, a critical variable included — the message says what to fix. |
| `migrate:status` | Applied / pending / failed migrations (folders shipped in the image vs `_prisma_migrations`). |
| `seat:status` | Local mode: who holds the host seat, since when, until when. |
| `seat:release` | Operator override: free the seat whoever holds it (e.g. claimed with no expiry and abandoned). |
| `user:list` | Accounts with subject, e-mail, role (as last provisioned), the operator grant if any, quiz count. |
| `user:set-role <sub\|email> host\|admin\|host,admin\|player` | Grant `host` (its holder's own bank: create, edit, present), `admin` (read the whole instance and administer it, without hosting) or both at once — sticky: never overridden by IdP claims or the host seat. `player` revokes every grant; the roles are derived again on the next request. |
| `samples:load <sub\|email>` | Add the sample quizzes to that user's bank, ready to present. |
| `quiz:list [<sub\|email>]` | Quizzes with id, title, owner, status, question count, slug, revision — every one, or one user's. |
| `quiz:export <id> <file.zip\|->` | The quiz as a bundle ([quiz-bundle.md](../quiz-bundle.md)), whoever owns it; `-` streams the zip to stdout. Leaves the `revision` alone — it moves when the quiz is shared. |
| `quiz:transfer <quiz-id> <sub\|email>` | Hand a quiz over to another account — an account that left, or a colleague taking over. The media only this quiz uses follow it; one shared with another of the previous owner's quizzes stays with them. Its archived sessions follow too, so their results become readable by the new owner. Refused while the quiz is being played. **Not** how hosts share their work: that is by copy. |
| `quiz:validate <file\|->` | Validate text-only `quiz.json` without writing; errors and completeness warnings, exit 0 structurally valid / 1 invalid. |
| `mcp [--user=<sub\|email>]` | Local stdio MCP, _experimental_; omit user for read-only tools. [Setup](mcp.md). |
| `quiz:import <file\|-> <sub\|email>` | A new draft in that user's bank from a bundle (zip or bare `quiz.json`) or a Kahoot `.xlsx` template; `-` reads stdin. Invalid bundles are refused as a whole. Kahoot imports report converted and skipped rows. |
| `sessions:purge [--dry-run]` | Delete archived sessions past their retention date (`retain_until`, 365 days at archive time) with their results. Nothing else purges them — schedule it (cron) if you need the retention enforced. |

Subjects: OIDC `sub`, or `local:<slug>` in local mode (`user:list` shows them).

### Operations

Each command above is an **operation** of the administration, also reachable by
its own name: `qd operations` lists them with their parameters.

```bash
qd operations
qd users.set-role --user=ada@example.org --roles=host,admin
qd sessions.purge --dry-run          # what it would delete
qd settings.list --key=APP_NAME      # a setting: value, source, default, problems
qd audit.list --limit=20             # the last administrative actions
qd settings.set --key=GAME_READ_DELAY_MS --value=4000   # an override, over .env
qd settings.reset --key=GAME_READ_DELAY_MS              # back to .env (--all for every one)
qd presets.apply --preset=classroom --dry-run           # what a preset would change
qd setup.token                       # a new setup token for the web wizard
qd setup.complete                    # skip the wizard (automated deployments)
```

| Option | Effect |
|---|---|
| `--yes` | Confirms a destructive operation, or one that changes administrator rights. Without it, `qd` asks on a terminal and refuses elsewhere. The commands of the table above never ask, as before. |
| `--dry-run` | Says what the operation would do, for those that can (`sessions.purge`). |
| `--json` | The outcome as JSON, for scripts. |
| `--as=<name>` | Who the audit records (default: the container's user). |

Every change made this way, and every refusal, is kept in the **audit** (who,
through what, which operation and its parameters, the outcome): `qd audit.list`.
From the host: `./quizdock qd <operation> …`.

## 3. Recipes

**Upgrade to a release**

```bash
./quizdock upgrade 0.10.0     # backup, pull, restart, migrations, doctor
```

**Someone left with the host seat (local mode)**

```bash
./quizdock seat:status
./quizdock seat:release
```

**Let someone host without the seat (or bootstrap an administrator)**

```bash
./quizdock user:list
./quizdock user:set-role alice@example.com host,admin   # manages the instance and hosts
```

**Move a quiz to another instance, or publish it**

```bash
./quizdock quiz:list alice@example.com          # find the id
./quizdock quiz:export 01J… ./capitals.quizdock.zip
# on the other instance:
./quizdock quiz:import ./capitals.quizdock.zip bob@example.com
```

**Enforce session retention weekly** (host crontab)

```cron
0 4 * * 1  cd /srv/quizdock && ./quizdock sessions:purge >> purge.log 2>&1
```

**Move to another server**

```bash
./quizdock backup ./move            # on the old host
# copy ./move, quizdock, docker-compose.prod.yml to the new host, then:
./quizdock init                     # same settings; or reuse ./move/env as .env
./quizdock up && ./quizdock restore ./move
```
