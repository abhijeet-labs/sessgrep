export type Tool = 'claude' | 'codex' | 'cursor';
export interface Message { role: 'user' | 'assistant'; text: string; ts?: string }
export interface Session {
  key: string; // `${tool}:${id}`
  tool: Tool;
  id: string;
  project: string; // cwd / workspace folder, '' if unknown
  started: string; // ISO, '' if unknown
  title: string;
  source: string; // file the session came from
  stamp: number; // mtime of source, for incremental indexing
  messages: Message[];
}
export interface Adapter {
  tool: Tool;
  root(): string;
  /** Yield sessions whose source changed since `known` (key -> stamp). */
  scan(known: Map<string, number>): Iterable<Session>;
}
export const home = () => process.env.HOME ?? process.env.USERPROFILE ?? '';
