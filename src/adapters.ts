import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename, delimiter } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Adapter, Message, Session, home } from './types.js';

function* walk(dir: string, ext: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, ext);
    else if (e.name.endsWith(ext)) yield p;
  }
}
function jsonl(file: string): any[] {
  const out: any[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip torn/partial line */ }
  }
  return out;
}
const clip = (s: string, n = 80) => s.replace(/\s+/g, ' ').trim().slice(0, n);

// ---- Claude Code: ~/.claude/projects/<slug>/<sessionId>.jsonl ----
function claudeText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  // keep prose only; tool calls/results/thinking are noise for search
  return content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n');
}
export const claude: Adapter = {
  tool: 'claude',
  // Several accounts = several config dirs. SESSGREP_CLAUDE_DIR is a path list (':' on Unix);
  // otherwise ~/.claude plus $CLAUDE_CONFIG_DIR (if set) plus any ~/.claude-* dir.
  roots() {
    if (process.env.SESSGREP_CLAUDE_DIR) return process.env.SESSGREP_CLAUDE_DIR.split(delimiter).filter(Boolean);
    const cfg = [join(home(), '.claude')];
    if (process.env.CLAUDE_CONFIG_DIR) cfg.push(process.env.CLAUDE_CONFIG_DIR);
    try { for (const e of readdirSync(home(), { withFileTypes: true })) if (e.isDirectory() && /^\.claude-/.test(e.name)) cfg.push(join(home(), e.name)); } catch { /* no home */ }
    return [...new Set(cfg)].map(c => join(c, 'projects'));
  },
  root() { return this.roots!().join(delimiter); },
  *scan(known) {
    for (const file of this.roots!().flatMap(r => [...walk(r, '.jsonl')])) {
      if (file.includes('/subagents/')) continue;
      const stamp = statSync(file).mtimeMs;
      const id = basename(file, '.jsonl');
      if (known.get(`claude:${id}`) === stamp) continue;
      const messages: Message[] = [];
      let project = '', started = '', title = '';
      for (const d of jsonl(file)) {
        if (d.cwd && !project) project = d.cwd;
        if (d.type === 'ai-title' && d.aiTitle) title = d.aiTitle;
        if ((d.type !== 'user' && d.type !== 'assistant') || d.isSidechain || d.isMeta) continue;
        const text = claudeText(d.message?.content).trim();
        if (!text) continue;
        if (!started && d.timestamp) started = d.timestamp;
        messages.push({ role: d.type, text, ts: d.timestamp });
      }
      if (!messages.length) continue;
      if (!title) title = clip(messages.find(m => m.role === 'user')?.text ?? id);
      yield { key: `claude:${id}`, tool: 'claude', id, project, started, title, source: file, stamp, messages };
    }
  },
};

// ---- Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl ----
export const codex: Adapter = {
  tool: 'codex',
  root: () => process.env.SESSGREP_CODEX_DIR ?? join(home(), '.codex', 'sessions'),
  *scan(known) {
    for (const file of walk(this.root(), '.jsonl')) {
      const stamp = statSync(file).mtimeMs;
      let id = basename(file, '.jsonl').replace(/^rollout-/, '');
      const rows = jsonl(file);
      const meta = rows.find(r => r.type === 'session_meta')?.payload;
      if (meta?.id) id = meta.id;
      if (known.get(`codex:${id}`) === stamp) continue;
      const messages: Message[] = [];
      for (const r of rows) {
        const p = r.payload;
        if (r.type !== 'response_item' || p?.type !== 'message') continue;
        if (p.role !== 'user' && p.role !== 'assistant') continue;
        const text = (p.content ?? []).filter((c: any) => typeof c.text === 'string').map((c: any) => c.text).join('\n').trim();
        // Codex injects environment/AGENTS.md context as user messages; skip those
        if (!text || text.startsWith('<environment_context>') || text.startsWith('# AGENTS.md')) continue;
        messages.push({ role: p.role, text, ts: r.timestamp });
      }
      if (!messages.length) continue;
      yield {
        key: `codex:${id}`, tool: 'codex', id, project: meta?.cwd ?? '', started: meta?.timestamp ?? messages[0].ts ?? '',
        title: clip(messages.find(m => m.role === 'user')?.text ?? id), source: file, stamp, messages,
      };
    }
  },
};

// ---- Cursor: globalStorage/state.vscdb, table cursorDiskKV ----
// composerData:<composerId> -> {createdAt, name, fullConversationHeadersOnly:[{bubbleId,type}] | conversation:[bubble]}
// bubbleId:<composerId>:<bubbleId> -> {type: 1 user | 2 assistant, text}
function cursorRoots(): string {
  if (process.env.SESSGREP_CURSOR_DIR) return process.env.SESSGREP_CURSOR_DIR;
  const h = home();
  if (process.platform === 'darwin') return join(h, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage');
  if (process.platform === 'win32') return join(process.env.APPDATA ?? h, 'Cursor', 'User', 'globalStorage');
  return join(h, '.config', 'Cursor', 'User', 'globalStorage');
}
/** composerId -> workspace folder, from workspaceStorage/<hash>/{workspace.json,state.vscdb} */
function cursorProjects(globalDir: string): Map<string, string> {
  const map = new Map<string, string>();
  const ws = join(globalDir, '..', 'workspaceStorage');
  if (!existsSync(ws)) return map;
  for (const d of readdirSync(ws)) {
    try {
      const folder = JSON.parse(readFileSync(join(ws, d, 'workspace.json'), 'utf8')).folder as string | undefined;
      if (!folder) continue;
      const db = new DatabaseSync(join(ws, d, 'state.vscdb'), { readOnly: true });
      const row = db.prepare("SELECT value FROM ItemTable WHERE key='composer.composerData'").get() as any;
      db.close();
      const path = decodeURIComponent(folder.replace(/^file:\/\//, ''));
      for (const c of JSON.parse(row?.value ?? '{}').allComposers ?? []) map.set(c.composerId, path);
    } catch { /* workspace without composer data */ }
  }
  return map;
}
export const cursor: Adapter = {
  tool: 'cursor',
  root: () => cursorRoots(),
  *scan(known) {
    const dir = this.root();
    const file = join(dir, 'state.vscdb');
    if (!existsSync(file)) return;
    const stamp = statSync(file).mtimeMs;
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const rows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as any[];
      const projects = cursorProjects(dir);
      const bubble = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?');
      for (const r of rows) {
        const id = String(r.key).slice('composerData:'.length);
        if (known.get(`cursor:${id}`) === stamp) continue;
        let c: any;
        try { c = JSON.parse(String(r.value)); } catch { continue; }
        let bubbles: any[] = Array.isArray(c.conversation) ? c.conversation : [];
        if (!bubbles.length) {
          bubbles = (c.fullConversationHeadersOnly ?? []).map((h: any) => {
            const b = bubble.get(`bubbleId:${id}:${h.bubbleId}`) as any;
            try { return b ? JSON.parse(String(b.value)) : null; } catch { return null; }
          });
        }
        const messages: Message[] = bubbles
          .filter(b => b && typeof b.text === 'string' && b.text.trim() && (b.type === 1 || b.type === 2))
          .map(b => ({ role: b.type === 1 ? 'user' as const : 'assistant' as const, text: b.text.trim() }));
        if (!messages.length) continue;
        const started = c.createdAt ? new Date(c.createdAt).toISOString() : '';
        yield {
          key: `cursor:${id}`, tool: 'cursor', id, project: projects.get(id) ?? '', started,
          title: c.name || clip(messages[0].text), source: file, stamp, messages,
        };
      }
    } finally { db.close(); }
  },
};
export const adapters: Adapter[] = [claude, codex, cursor];
