# Quiz conversion with a local MCP client

> **Experimental.** The tools are covered by the backend's tests, but the connector
> has not been tried end to end with every chatbot client yet. Its commands and
> answers may change. A problem, or a client it works with:
> [open an issue](https://github.com/quizdock/quiz-dock/issues/new/choose).

QuizDock provides a **local stdio MCP server** for clients that can spawn a
process (for example a desktop client). It uses the backend's generated format
guide and real import schemas. It opens no HTTP MCP listener and works on a LAN
or offline instance through the operator's existing Docker or SSH access.

## Tools

| Tool | Effect |
| --- | --- |
| `quiz_format` | Returns the current format guide, generated from the importer schemas. |
| `validate_quiz` | Takes `json`, the complete `quiz.json` as a string. Returns `valid`, up to 100 structural errors and up to 100 completeness warnings, with the importer's codes, one-based item numbers, fields and details. Writes nothing. |
| `import_quiz` | Takes the same string and creates a new draft in the configured host's account. Available only when the operator supplies `--user`. No quiz is overwritten. |

The flow is: obtain the guide, convert the source, validate and repair errors,
then import. Review the draft's correct answers before playing. Input is
**text-only**: no images, audio, archives or external media URLs. Media references
are rejected with `import.media_missing`; add your own media in the editor.

## Configure a client

The client machine needs access to the running container. List accounts with
`qd user:list` and choose the host's subject or e-mail. The account must already
exist and have the **host** role; administrator alone is not enough.

Example client configuration (replace the container and subject):

```json
{
  "mcpServers": {
    "quizdock": {
      "command": "docker",
      "args": ["exec", "-i", "quizdock", "qd", "mcp", "--user=local:alex"]
    }
  }
}
```

The operator wrapper also supports `./quizdock mcp --user=local:alex`, from its
installation directory. Compose uses `exec -T`; **do not allocate a TTY**. For
an instance on another machine, the command can run over SSH, for example:

```sh
ssh -T operator@quiz-host docker exec -i quizdock qd mcp --user=local:alex
```

Configure the client's executable and arguments to match your installation.
Without `--user`, only the format and validation tools are exposed; this mode
needs no database, Redis or account configuration. In a source checkout, run
`node apps/backend/dist/cli.js mcp` after building the contracts and backend.

### Account access and content

The operator grants access by configuring the process and choosing its account.
Authentication is the existing operating-system/container/SSH access, not a new
user token. The model cannot choose another owner in a tool call. Host roles are
checked again before every import; removing the host role prevents further
imports. Stop the MCP process or remove its client configuration to disconnect it.
Do not give a client unrestricted Docker/SSH access unless it is trusted with the
operator's existing privileges.

The quiz source and the tool results are available to the configured chatbot
provider, as with the manual conversion prompt. The connector itself makes no
outgoing request; choose a provider appropriate for the content you share.
Cloud-only clients that require a remote HTTP MCP endpoint are not supported by
this transport. Remote OAuth delegation and personal access tokens remain a
separate future design; this feature does not expose an operator credential over
HTTP.

## HTTP and CLI dry-run

Authenticated hosts can call `POST /api/v1/quizzes/validate` using the instance's
existing browser authentication:

```json
{ "json": "{\"format\":\"quizdock/quiz\",\"quiz\":{\"title\":\"Example\"},\"items\":[]}" }
```

A successful validation request returns HTTP 200 with `{ "valid": true,
"errors": [], "warnings": [] }`; invalid content also returns 200 with `valid: false` and errors
so a client can repair it. Authentication/authorization errors remain 401/403.
There is no database write or media fetch during validation.

For a local file:

```sh
./quizdock quiz:validate quiz.json
# In the container, '-' reads stdin:
qd quiz:validate - < quiz.json
```

The CLI prints the same JSON result and exits 0 when structurally valid, 1 when invalid.
Completeness warnings (for example, a missing correct answer or an empty slide)
do not prevent importing a draft; finish these steps in the editor before publishing.
Validation does not require a database connection.

## Limits and shutdown

Text JSON is limited to 1 MiB of UTF-8 (or `IMPORT_MAX_BYTES`, if smaller), and
uses the normal 500-item and content limits. MCP input buffering is bounded as
well. Each MCP process accepts at most 60 tool calls and ten import attempts per
minute, with one import at a time. Concurrent imports return `mcp.busy`; excess
calls return `mcp.rate_limit`. These MCP limits are per-process, not a distributed quota.
The authenticated HTTP validation endpoint has a bounded input and no per-user counter.

Stdout contains only JSON-RPC; diagnostics go to stderr. EOF, SIGINT and SIGTERM
close the server and let an in-flight import finish before closing its database
connection.
