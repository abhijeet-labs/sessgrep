import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Message, Session, Tool, home } from './types.js';

export const dataDir = () => process.env.SESSGREP_HOME ?? join(process.env.XDG_DATA_HOME ?? join(home(), '.local', 'share'), 'sessgrep');

export function open(): DatabaseSync {
  mkdirSync(dataDir(), { recursive: true });
  const db = new DatabaseSync(join(dataDir(), 'index.db'));
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS sessions(key TEXT PRIMARY KEY, tool TEXT, id TEXT, project TEXT, started TEXT, title TEXT, source TEXT, stamp REAL);
    CREATE TABLE IF NOT EXISTS messages(rowid INTEGER PRIMARY KEY, session_key TEXT, idx INTEGER, role TEXT, ts TEXT, text TEXT);
    CREATE INDEX IF NOT EXISTS messages_session ON messages(session_key, idx);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text, content='messages', content_rowid='rowid', tokenize='porter unicode61');
  `);
  return db;
}

export function knownStamps(db: DatabaseSync): Map<string, number> {
  return new Map((db.prepare('SELECT key, stamp FROM sessions').all() as any[]).map(r => [r.key, r.stamp]));
}

/** Replace one session atomically. Sessions are never deleted when their source disappears (Claude Code prunes logs after ~30 days; we keep them). */
export function upsert(db: DatabaseSync, s: Session): void {
  db.exec('BEGIN');
  try {
    for (const r of db.prepare('SELECT rowid, text FROM messages WHERE session_key=?').all(s.key) as any[])
      db.prepare("INSERT INTO fts(fts, rowid, text) VALUES('delete', ?, ?)").run(r.rowid, r.text);
    db.prepare('DELETE FROM messages WHERE session_key=?').run(s.key);
    db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?,?,?,?,?,?)').run(s.key, s.tool, s.id, s.project, s.started, s.title, s.source, s.stamp);
    const ins = db.prepare('INSERT INTO messages(session_key, idx, role, ts, text) VALUES(?,?,?,?,?)');
    const fts = db.prepare('INSERT INTO fts(rowid, text) VALUES(?, ?)');
    s.messages.forEach((m, i) => {
      const r = ins.run(s.key, i, m.role, m.ts ?? '', m.text);
      fts.run(r.lastInsertRowid, m.text);
    });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export interface Filters { tool?: Tool; project?: string; since?: string; until?: string; limit?: number }
export interface Hit { key: string; tool: Tool; id: string; project: string; started: string; title: string; snippet: string; matches: number }

/** Quote each term so user input can't be parsed as FTS5 syntax; `raw` opts back in. */
export function toMatch(q: string, raw: boolean): string {
  if (raw) return q;
  return q.split(/\s+/).filter(Boolean).map(t => `"${t.replace(/"/g, '""')}"`).join(' ');
}

export function search(db: DatabaseSync, q: string, f: Filters, raw = false): Hit[] {
  const where: string[] = []; const args: any[] = [];
  if (f.tool) { where.push('tool = ?'); args.push(f.tool); }
  if (f.project) { where.push('project LIKE ?'); args.push(`%${f.project}%`); }
  if (f.since) { where.push('started >= ?'); args.push(f.since); }
  if (f.until) { where.push('started <= ?'); args.push(f.until + '\uffff'); }
  // bm25()/snippet() only work in a plain FTS query, so rank first, then attach sessions and group in JS.
  const ranked = db.prepare(`SELECT rowid AS rid, bm25(fts) AS rank, snippet(fts, 0, '[', ']', '…', 14) AS snip
    FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT 5000`).all(toMatch(q, raw)) as any[];
  const sess = db.prepare(`SELECT s.* FROM messages m JOIN sessions s ON s.key = m.session_key WHERE m.rowid = ?
    ${where.map(w => 'AND s.' + w).join(' ')}`);
  const byKey = new Map<string, Hit>();
  for (const r of ranked) {
    const s = sess.get(r.rid, ...args) as any;
    if (!s) continue;
    const h = byKey.get(s.key);
    if (h) h.matches++;
    else byKey.set(s.key, { key: s.key, tool: s.tool, id: s.id, project: s.project, started: s.started, title: s.title, snippet: r.snip, matches: 1 });
  }
  return [...byKey.values()].slice(0, f.limit ?? 20);
}

export function find(db: DatabaseSync, ref: string): { s: any; messages: Message[] } {
  const rows = db.prepare("SELECT * FROM sessions WHERE key = ? OR id = ? OR id LIKE ? OR key LIKE ? ORDER BY started DESC").all(ref, ref, ref + '%', ref + '%') as any[];
  if (!rows.length) throw new Error(`no session matches "${ref}" (try: sessgrep list)`);
  if (rows.length > 1 && !rows.some(r => r.key === ref || r.id === ref))
    throw new Error(`"${ref}" is ambiguous:\n` + rows.map(r => `  ${r.tool}:${r.id}`).join('\n'));
  const s = rows.find(r => r.key === ref || r.id === ref) ?? rows[0];
  const messages = db.prepare('SELECT role, ts, text FROM messages WHERE session_key=? ORDER BY idx').all(s.key) as any[];
  return { s, messages };
}

export function list(db: DatabaseSync, f: Filters): any[] {
  const where: string[] = ['1=1']; const args: any[] = [];
  if (f.tool) { where.push('tool = ?'); args.push(f.tool); }
  if (f.project) { where.push('project LIKE ?'); args.push(`%${f.project}%`); }
  if (f.since) { where.push('started >= ?'); args.push(f.since); }
  if (f.until) { where.push('started <= ?'); args.push(f.until + '￿'); }
  args.push(f.limit ?? 20);
  return db.prepare(`SELECT * FROM sessions WHERE ${where.join(' AND ')} ORDER BY started DESC LIMIT ?`).all(...args) as any[];
}
