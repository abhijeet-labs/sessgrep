#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { adapters } from './adapters.js';
import { open, knownStamps, upsert, search, find, list, dataDir, Filters } from './db.js';
import { toMarkdown } from './export.js';
import { redact } from './redact.js';
import { Tool } from './types.js';

const HELP = `sessgrep: search past AI coding sessions (Claude Code, Codex, Cursor). Local only.

  sessgrep index                      build/refresh the index (also runs automatically before search)
  sessgrep search <words> [filters]   full-text search; one line per matching session
  sessgrep list [filters]             most recent sessions
  sessgrep show <id>                  print a session (id or unique prefix; tool:id also works)
  sessgrep export <id> [--max-chars N] [-o file]
                                      clean markdown to paste into any agent (keeps newest turns if capped)
  sessgrep doctor                     where each tool's logs were looked for

Filters: --tool claude|codex|cursor  --project <substring>  --since YYYY-MM-DD  --until YYYY-MM-DD  --limit N
show/export: secrets (API keys, tokens, JWTs, private keys, KEY=value) are masked by default; --no-redact to keep them.
            Masking is best-effort, review before sharing.
Search:  --raw  treat the query as FTS5 syntax (AND/OR/NEAR/prefix*)
Env: SESSGREP_HOME, SESSGREP_CLAUDE_DIR, SESSGREP_CODEX_DIR, SESSGREP_CURSOR_DIR`;

const { values: v, positionals: pos } = parseArgs({
  allowPositionals: true,
  options: {
    tool: { type: 'string' }, project: { type: 'string' }, since: { type: 'string' }, until: { type: 'string' },
    limit: { type: 'string' }, raw: { type: 'boolean' }, 'no-redact': { type: 'boolean' }, 'max-chars': { type: 'string' }, o: { type: 'string', short: 'o' },
    help: { type: 'boolean', short: 'h' }, quiet: { type: 'boolean', short: 'q' },
  },
});
const [cmd, ...rest] = pos;
const filters: Filters = { tool: v.tool as Tool | undefined, project: v.project, since: v.since, until: v.until, limit: v.limit ? Number(v.limit) : undefined };

function die(msg: string): never { console.error(msg); process.exit(1); }

function reindex(db: ReturnType<typeof open>, say: boolean) {
  const known = knownStamps(db);
  let n = 0;
  for (const a of adapters) {
    if (!(a.roots?.() ?? [a.root()]).some(existsSync)) { if (say) console.error(`  ${a.tool}: not found (${a.root()}), skipped`); continue; }
    try {
      for (const s of a.scan(known)) { upsert(db, s); n++; }
    } catch (e) { console.error(`  ${a.tool}: could not read (${(e as Error).message}), skipped`); }
  }
  if (say) console.error(`indexed ${n} new/changed session(s)`);
}

const when = (s: string) => s ? s.slice(0, 10) : '????-??-??';
const short = (p: string) => p ? p.replace(process.env.HOME ?? '\0', '~') : '-';

if (v.help || !cmd || cmd === 'help') { console.log(HELP); process.exit(0); }
if (cmd === 'doctor') {
  for (const a of adapters) for (const r of a.roots?.() ?? [a.root()]) console.log(`${(a.tool + (a.tool === 'claude' ? '' : ' (experimental)')).padEnd(20)} ${existsSync(r) ? 'found    ' : 'not found'} ${r}`);
  console.log(`index   ${dataDir()}`);
  process.exit(0);
}
const db = open();
try {
  if (cmd === 'index') reindex(db, true);
  else if (cmd === 'search') {
    if (!rest.length) die('usage: sessgrep search <words>');
    reindex(db, false);
    let hits;
    try { hits = search(db, rest.join(' '), filters, v.raw); } catch (e) { die(`bad query: ${(e as Error).message}`); }
    if (!hits.length) { console.error('no matches'); process.exit(1); }
    for (const h of hits) {
      console.log(`${h.tool}:${h.id.slice(0, 8)}  ${when(h.started)}  ${short(h.project)}  (${h.matches} msg)`);
      console.log(`  ${h.title.slice(0, 90)}`);
      console.log(`  ${h.snippet.replace(/\s+/g, ' ')}`);
    }
  } else if (cmd === 'list') {
    reindex(db, false);
    for (const s of list(db, filters)) console.log(`${s.tool}:${s.id.slice(0, 8)}  ${when(s.started)}  ${short(s.project)}  ${s.title.slice(0, 70)}`);
  } else if (cmd === 'show' || cmd === 'export') {
    if (!rest[0]) die(`usage: sessgrep ${cmd} <id>`);
    reindex(db, false);
    const { s, messages } = find(db, rest[0]);
    let md = toMarkdown(s, messages, cmd === 'export' && v['max-chars'] ? Number(v['max-chars']) : 0);
    if (!v['no-redact']) md = redact(md);
    if (v.o) { (await import('node:fs')).writeFileSync(v.o, md); console.error(`wrote ${v.o}`); } else process.stdout.write(md + '\n');
  } else die(HELP);
} catch (e) { die((e as Error).message); }
