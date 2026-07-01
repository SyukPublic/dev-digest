# @devdigest/mcp — DevDigest MCP server (L04)

A local **Model Context Protocol** server that exposes the DevDigest PR-review
engine to an MCP client (e.g. Claude Code) over **stdio**.

It is a thin **onion edge** (variant A — HTTP bridge): every tool calls the
already-running local DevDigest API (`@devdigest/api`, default
`http://localhost:3001`). This process holds **no DB, no secrets, no review
logic** — it depends only on `@modelcontextprotocol/sdk`, `zod`, the
`@devdigest/shared` Zod contracts, and `fetch`. Never on `server/src/**`
internals or Drizzle.

## Tools

All tools are namespaced with the `devdigest_` prefix. Outputs are trimmed to
high-signal fields; reviews come back as a concise `{ verdict, findings[] }`.

| Tool | Kind | What it does |
|---|---|---|
| `devdigest_list_agents` | read | List the PR-review agents in the workspace. Call this first — `devdigest_run_agent_on_pr` needs a valid `agent` id from here. |
| `devdigest_get_conventions` | read | The repo's coding conventions (extracted in L02): each rule with its evidence path + confidence. Args: `repo`. |
| `devdigest_get_findings` | read | `{ verdict, findings[] }` from the latest review run on a PR, without starting a new one. Args: `repo`, `pr`. |
| `devdigest_get_blast_radius` | read | Impact map of a PR — changed symbols, downstream callers, impacted endpoints, plus an index `status`. Args: `repo`, `pr`. |
| `devdigest_run_agent_on_pr` | **write** | Run a review agent on a PR and return the finished `{ verdict, findings[] }` in one call. The only tool that starts a review. Args: `repo`, `pr`, `agent`. |

Argument shapes are flat scalars:

- `repo` — repository as `owner/name`.
- `pr` — pull-request number.
- `agent` — an agent id from `devdigest_list_agents`, or `all` to run every enabled agent.

## Prerequisites

- Node ≥ 22, pnpm ≥ 10.
- The DevDigest API up and the DB **seeded** — `./scripts/dev.sh` (or
  `cd server && pnpm db:seed`). Tenancy is resolved server-side by
  `LocalNoAuthProvider`; without a seeded default workspace the API throws
  `No default workspace found`.

## Run

```bash
cd mcp
pnpm install          # if you hit ERR_PNPM_IGNORED_BUILDS, run: pnpm approve-builds (approve esbuild)
pnpm typecheck        # tsc --noEmit
pnpm dev              # tsx src/index.ts — serves MCP over stdio
```

`DEVDIGEST_API_URL` overrides the API base (default `http://localhost:3001`).
stdout is the JSON-RPC channel — the server logs to **stderr only**.

## Register with an MCP client

The repo root ships `.mcp.json.example` (variant 1 — the server runs natively,
stdio is local pipes). Copy it to `.mcp.json` (which is git-ignored, so local
tweaks stay out of version control):

```json
{
  "mcpServers": {
    "devdigest-mcp": {
      "command": "npx",
      "args": ["-y", "tsx", "src/index.ts"],
      "cwd": "./mcp",
      "env": { "DEVDIGEST_API_URL": "http://localhost:3001" }
    }
  }
}
```

### WSL note

On this dev machine the API + DB run inside WSL2, while the MCP client runs on
Windows. Variant 1 (above) keeps the **transport** on Windows-local pipes and
reaches the WSL API via WSL2 localhost forwarding — no `wsl.exe` in the stdio
path. If you instead launch the server *inside* WSL (`command: wsl.exe`), use
`bash -c` (not `-lc`): a login shell may print MOTD to stdout and corrupt the
JSON-RPC stream.

> Heads-up: `tsx watch` running inside WSL does **not** pick up edits to files on
> `/mnt/e` made from Windows (inotify doesn't cross the boundary). After changing
> server code, restart the API process so the MCP server talks to fresh code.

## Layout

```
src/
  config.ts          DEVDIGEST_API_URL → { apiUrl }
  api-client.ts      thin fetch wrapper; parses every response against @devdigest/shared
  format.ts          pure DTO → concise tool-output mappers
  sse.ts             pure SSE frame parser (run-event stream)
  tools/
    registry.ts      defineTool / registerAll over McpServer.registerTool
    resolve.ts       repo (owner/name) → repoId, (repoId, pr) → pullId
    *.ts             one thin handler per tool
  index.ts           constructs McpServer, registers tools, connects stdio
```
