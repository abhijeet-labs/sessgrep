# Fixtures

- `claude/`: trimmed from real Claude Code logs, content replaced.
- `codex/.../33333333...jsonl`: built from the layout described in public docs of third-party readers
  (txcript `docs/formats/codex.md`, agent-top-core, brokk-sessionwiki; Codex CLI 0.149 notes): `session_meta` with `session_id` (newer) vs `id`,
  `turn_context`, `response_item` message/reasoning/function_call, `input_text`/`output_text` blocks. Not captured from a real install.
- `codex/.../22222222...jsonl`: older-style layout (`id`), hand-written.
- `cursor/`: SQLite generated at test time from the documented `cursorDiskKV` key layout. Fixture-only; no public spec found.
