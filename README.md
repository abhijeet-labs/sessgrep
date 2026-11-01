# sessgrep

Search every past AI coding session (Claude Code, Codex, Cursor) from one command, and paste any of them back into any agent as clean markdown.

- **Local only.** No network code, no telemetry, no accounts. Read-only on your agent logs.
- **Touches nothing.** No hooks, no MCP server, no edits to your agent configs. Delete the index and nothing changed.
- **Zero dependencies.** ~500 lines of TypeScript on Node's built-in SQLite (FTS5). Read all of it in ten minutes.
- **Keeps history.** Claude Code prunes old logs; sessgrep keeps what it has already indexed.

> Demo GIF: _TODO before launch (record with `vhs demo.tape`)._

## Install

Needs Node 22.13+.

```sh
npx sessgrep search "stripe webhook 401"      # no install
npm i -g sessgrep                              # or install
```

(Until published to npm: `git clone <repo> && cd sessgrep && npm i && npm run build && npm link`.)

## Use

```sh
sessgrep search "cursor pagination" --tool codex --since 2026-10-01
sessgrep search "docker" --project infra
sessgrep list --limit 10
sessgrep show 1d2b5750                       # print a session
sessgrep export claude:1d2b5750 --max-chars 20000 | pbcopy   # newest turns, ready to paste
sessgrep export 1d2b5750 -o context.md
sessgrep doctor                              # where logs are looked for
```

Search is full-text (SQLite FTS5, stemmed, ranked by BM25); results are one line per session with a snippet. `--raw` accepts FTS5 syntax (`webhook AND secret*`). The index lives in `~/.local/share/sessgrep/index.db` and refreshes incrementally before each search.

## Where it reads

| Tool | Path | Format |
|---|---|---|
| Claude Code | `~/.claude/projects/<project>/<session>.jsonl` | JSONL; `user`/`assistant` lines, text blocks only (thinking, tool calls and results skipped), `ai-title` as title |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | JSONL; `session_meta` + `response_item` messages; injected `<environment_context>` skipped |
| Cursor | `state.vscdb` in Cursor's `globalStorage` (`~/.config/Cursor/User/...` Linux, `~/Library/Application Support/Cursor/User/...` macOS, `%APPDATA%\Cursor\User\...` Windows) | SQLite `cursorDiskKV`: `composerData:<id>` + `bubbleId:<id>:<bubble>`; project from `workspaceStorage` |

Override with `SESSGREP_CLAUDE_DIR`, `SESSGREP_CODEX_DIR`, `SESSGREP_CURSOR_DIR`, `SESSGREP_HOME`. A missing tool is skipped with a note. These are undocumented internal formats and can change; the Claude Code format is verified against current real logs, Codex and Cursor against fixtures built from the known layouts (please file an issue if your install differs).

## How it compares (honest version)

| | sessgrep | [deja-vu](https://github.com/vshulcz/deja-vu) | [coding_agent_session_search](https://github.com/Dicklesworthstone/coding_agent_session_search) | [agent-sessions](https://github.com/jazzyalex/agent-sessions) |
|---|---|---|---|---|
| Agents | 3 | 43 | 30+ | 16 |
| Platform | anywhere Node runs | macOS/Linux (Windows less tested) | CLI + TUI | macOS app only |
| Installs hooks / MCP / config into your agents | **no** | yes (optional) | no | no |
| Resume / handoff / sync / semantic search | no | yes | hybrid search | resume |
| Size | ~500 lines, 0 deps | large | large (Rust) | native app |

If you want the full-featured memory layer for many agents, **use deja-vu**: it does far more. Switch to sessgrep if you want the smallest thing that does search + export for the big three, that you can audit in one sitting and that never touches your agent setup.

## Develop

```sh
npm i && npm test
```

Tests run the built CLI against fixture logs for all three tools (the Cursor SQLite fixture is generated at test time).

MIT licensed.
