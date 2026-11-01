import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const fx = resolve('test/fixtures');
const tmp = mkdtempSync(join(tmpdir(), 'sessgrep-'));
const cursorDir = join(tmp, 'Cursor', 'User', 'globalStorage');

// Cursor fixture is a real SQLite file in Cursor's cursorDiskKV layout, built here (no binary blobs in git).
// Covers both layouts: headers-only + separate bubbleId rows, and inline `conversation`.
before(async () => {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(cursorDir, { recursive: true });
  mkdirSync(join(tmp, 'Cursor', 'User', 'workspaceStorage', 'ws1'), { recursive: true });
  const db = new DatabaseSync(join(cursorDir, 'state.vscdb'));
  db.exec('CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
  const put = (k, v) => db.prepare('INSERT INTO cursorDiskKV VALUES (?,?)').run(k, JSON.stringify(v));
  put('composerData:cccc3333', { composerId: 'cccc3333', name: 'Dockerfile slimming', createdAt: Date.parse('2026-10-29T10:00:00Z'),
    fullConversationHeadersOnly: [{ bubbleId: 'b1', type: 1 }, { bubbleId: 'b2', type: 2 }] });
  put('bubbleId:cccc3333:b1', { type: 1, text: 'Make the Dockerfile smaller, image is 1.4GB' });
  put('bubbleId:cccc3333:b2', { type: 2, text: 'Switched to a multi-stage build with distroless runtime.' });
  put('composerData:dddd4444', { composerId: 'dddd4444', createdAt: Date.parse('2026-10-31T10:00:00Z'),
    conversation: [{ type: 1, text: 'inline layout question about zebra striping' }, { type: 2, text: 'use nth-child(even)' }] });
  db.close();
  const ws = new DatabaseSync(join(tmp, 'Cursor', 'User', 'workspaceStorage', 'ws1', 'state.vscdb'));
  ws.exec('CREATE TABLE ItemTable (key TEXT UNIQUE, value BLOB)');
  ws.prepare('INSERT INTO ItemTable VALUES (?,?)').run('composer.composerData', JSON.stringify({ allComposers: [{ composerId: 'cccc3333' }] }));
  ws.close();
  (await import('node:fs')).writeFileSync(join(tmp, 'Cursor', 'User', 'workspaceStorage', 'ws1', 'workspace.json'), JSON.stringify({ folder: 'file:///home/dev/infra' }));
});

const run = (args, env = {}) => execFileSync('node', ['dist/cli.js', ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, SESSGREP_HOME: join(tmp, 'idx'), SESSGREP_CLAUDE_DIR: join(fx, 'claude'), SESSGREP_CODEX_DIR: join(fx, 'codex'), SESSGREP_CURSOR_DIR: cursorDir, ...env },
});

test('finds sessions in all three tools', () => {
  assert.match(run(['search', 'webhook']), /claude:11111111/);
  assert.match(run(['search', 'pagination']), /codex:22222222/);
  assert.match(run(['search', 'distroless']), /cursor:cccc3333/);
  assert.match(run(['search', 'zebra']), /cursor:dddd4444/);
});
test('filters: tool, project, date', () => {
  assert.throws(() => run(['search', 'pagination', '--tool', 'claude']));
  assert.match(run(['search', 'dockerfile', '--project', 'infra']), /cursor:cccc3333/);
  assert.match(run(['search', 'webhook', '--since', '2026-10-28', '--until', '2026-10-28']), /claude/);
  assert.throws(() => run(['search', 'webhook', '--since', '2026-10-29']));
});
test('tool calls, thinking and tool results are not indexed', () => {
  assert.throws(() => run(['search', 'hidden thought']));
  assert.throws(() => run(['search', 'noise']));
});
test('codex environment context is skipped; title falls back to first prompt', () => {
  assert.throws(() => run(['search', 'environment_context']));
  assert.match(run(['list', '--tool', 'codex']), /Add pagination/);
});
test('claude: ai-title, torn line tolerated', () => {
  assert.match(run(['list', '--tool', 'claude']), /Fix Stripe webhook 401/);
});
test('export gives markdown, max-chars keeps newest turns', () => {
  const md = run(['export', 'claude:11111111']);
  assert.match(md, /^# Previous session: Fix Stripe webhook 401/);
  assert.match(md, /## User\n\nWhy does the checkout/);
  const small = run(['export', '11111111', '--max-chars', '350']);
  assert.match(small, /earlier turns omitted/);
  assert.match(small, /Tests pass/);
});
test('cursor project resolved from workspaceStorage', () => {
  assert.match(run(['list', '--tool', 'cursor']), /\/home\/dev\/infra/);
});
test('ambiguous / unknown ids error clearly', () => {
  assert.throws(() => run(['show', 'nope']), /no session matches/);
});
test('missing tools are skipped gracefully', () => {
  const out = run(['index'], { SESSGREP_CLAUDE_DIR: '/nonexistent', SESSGREP_CODEX_DIR: '/nonexistent', SESSGREP_CURSOR_DIR: '/nonexistent' });
  assert.equal(out, '');
});
test('query syntax in user input is safe', () => {
  assert.throws(() => run(['search', 'AND OR "']), /no matches/);
});
test('sessions survive source deletion (index keeps history)', () => {
  run(['index']);
  const out = run(['search', 'webhook'], { SESSGREP_CLAUDE_DIR: '/nonexistent' });
  assert.match(out, /claude:11111111/);
});
