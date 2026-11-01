import { Message } from './types.js';

/** Markdown transcript meant to be pasted into any agent as context. `maxChars` keeps the most recent turns. */
export function toMarkdown(s: { tool: string; id: string; project: string; started: string; title: string }, messages: Message[], maxChars = 0): string {
  const head = [
    `# Previous session: ${s.title}`,
    '',
    `- Tool: ${s.tool}`,
    s.project ? `- Project: ${s.project}` : null,
    s.started ? `- Started: ${s.started}` : null,
    `- Session id: ${s.id}`,
    '',
    'Context from an earlier AI coding session. Use it as background; continue from where it left off.',
    '',
  ].filter((l): l is string => l !== null).join('\n');
  const turns = messages.map(m => `## ${m.role === 'user' ? 'User' : 'Assistant'}\n\n${m.text}\n`);
  if (!maxChars) return head + '\n' + turns.join('\n');
  const kept: string[] = []; let size = head.length;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (size + turns[i].length > maxChars && kept.length) break;
    kept.unshift(turns[i]); size += turns[i].length;
  }
  const omitted = turns.length - kept.length;
  return head + '\n' + (omitted ? `_(${omitted} earlier turns omitted to fit ${maxChars} chars)_\n\n` : '') + kept.join('\n');
}
