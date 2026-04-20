/**
 * normalize.ts — Convert any chat export format to memorize transcript format.
 *
 * Supported: Plain text with > markers, Claude.ai JSON, ChatGPT conversations.json,
 * Claude Code JSONL, OpenAI Codex CLI JSONL, Slack JSON, plain text passthrough.
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

function extractContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === 'string') parts.push(item);
      else if (
        typeof item === 'object' &&
        item !== null &&
        (item as Record<string, unknown>).type === 'text'
      )
        parts.push(((item as Record<string, unknown>).text as string) ?? '');
    }
    return parts.join(' ').trim();
  }
  if (typeof content === 'object' && content !== null)
    return ((content as Record<string, unknown>).text as string)?.trim() ?? '';
  return '';
}

type Message = ['user' | 'assistant', string];

function messagesToTranscript(messages: Message[]): string {
  const lines: string[] = [];
  let i = 0;
  while (i < messages.length) {
    const [role, text] = messages[i]!;
    if (role === 'user') {
      lines.push(`> ${text}`);
      if (i + 1 < messages.length && messages[i + 1]![0] === 'assistant') {
        lines.push(messages[i + 1]![1]);
        i += 2;
      } else {
        i += 1;
      }
    } else {
      lines.push(text);
      i += 1;
    }
    lines.push('');
  }
  return lines.join('\n');
}

function tryClaudeCodeJsonl(content: string): string | null {
  const lines = content
    .trim()
    .split('\n')
    .filter((l) => l.trim());
  const messages: Message[] = [];
  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof entry !== 'object' || entry === null) continue;
    const msgType = entry.type as string;
    const message = entry.message as Record<string, unknown> | undefined;
    if (msgType === 'human' || msgType === 'user') {
      const text = extractContent(message?.content);
      if (text) messages.push(['user', text]);
    } else if (msgType === 'assistant') {
      const text = extractContent(message?.content);
      if (text) messages.push(['assistant', text]);
    }
  }
  return messages.length >= 2 ? messagesToTranscript(messages) : null;
}

function tryCodexJsonl(content: string): string | null {
  const lines = content
    .trim()
    .split('\n')
    .filter((l) => l.trim());
  const messages: Message[] = [];
  let hasSessionMeta = false;
  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof entry !== 'object' || entry === null) continue;
    if (entry.type === 'session_meta') {
      hasSessionMeta = true;
      continue;
    }
    if (entry.type !== 'event_msg') continue;
    const payload = entry.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') continue;
    const msg = payload.message;
    if (typeof msg !== 'string' || !msg.trim()) continue;
    if (payload.type === 'user_message') messages.push(['user', msg.trim()]);
    else if (payload.type === 'agent_message') messages.push(['assistant', msg.trim()]);
  }
  return messages.length >= 2 && hasSessionMeta ? messagesToTranscript(messages) : null;
}

function tryClaudeAiJson(data: unknown): string | null {
  let list: unknown[];
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    list = (obj.messages ?? obj.chat_messages ?? []) as unknown[];
  } else if (Array.isArray(data)) {
    list = data;
  } else {
    return null;
  }
  if (!Array.isArray(list) || list.length === 0) return null;

  // Privacy export: array of conversation objects with chat_messages inside
  const first = list[0] as Record<string, unknown> | undefined;
  if (first && typeof first === 'object' && 'chat_messages' in first) {
    const messages: Message[] = [];
    for (const convo of list) {
      const c = convo as Record<string, unknown>;
      const chatMsgs = (c.chat_messages ?? []) as Record<string, unknown>[];
      for (const item of chatMsgs) {
        const role = item.role as string;
        const text = extractContent(item.content);
        if ((role === 'user' || role === 'human') && text) messages.push(['user', text]);
        else if ((role === 'assistant' || role === 'ai') && text)
          messages.push(['assistant', text]);
      }
    }
    return messages.length >= 2 ? messagesToTranscript(messages) : null;
  }

  // Flat messages list
  const messages: Message[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    const role = obj.role as string;
    const text = extractContent(obj.content);
    if ((role === 'user' || role === 'human') && text) messages.push(['user', text]);
    else if ((role === 'assistant' || role === 'ai') && text) messages.push(['assistant', text]);
  }
  return messages.length >= 2 ? messagesToTranscript(messages) : null;
}

function tryChatgptJson(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('mapping' in data)) return null;
  const mapping = (data as Record<string, unknown>).mapping as Record<
    string,
    Record<string, unknown>
  >;
  const messages: Message[] = [];

  let rootId: string | null = null;
  let fallbackRoot: string | null = null;
  for (const [nodeId, node] of Object.entries(mapping)) {
    if (node.parent === null || node.parent === undefined) {
      if (!node.message) {
        rootId = nodeId;
        break;
      } else if (!fallbackRoot) {
        fallbackRoot = nodeId;
      }
    }
  }
  rootId ??= fallbackRoot;

  if (rootId) {
    let currentId: string | null = rootId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const node: Record<string, unknown> | undefined = mapping[currentId];
      if (!node) break;
      const msg = node.message as Record<string, unknown> | undefined;
      if (msg) {
        const role = ((msg.author as Record<string, unknown>)?.role as string) ?? '';
        const content = msg.content as Record<string, unknown> | undefined;
        const parts = (content?.parts as unknown[]) ?? [];
        const text = parts
          .filter((p): p is string => typeof p === 'string' && p.length > 0)
          .join(' ')
          .trim();
        if (role === 'user' && text) messages.push(['user', text]);
        else if (role === 'assistant' && text) messages.push(['assistant', text]);
      }
      const children: string[] = (node.children as string[]) ?? [];
      currentId = children[0] ?? null;
    }
  }
  return messages.length >= 2 ? messagesToTranscript(messages) : null;
}

function trySlackJson(data: unknown): string | null {
  if (!Array.isArray(data)) return null;
  const messages: Message[] = [];
  const seenUsers = new Map<string, 'user' | 'assistant'>();
  let lastRole: 'user' | 'assistant' | null = null;

  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    if (obj.type !== 'message') continue;
    const userId = (obj.user ?? obj.username ?? '') as string;
    const text = ((obj.text as string) ?? '').trim();
    if (!text || !userId) continue;

    if (!seenUsers.has(userId)) {
      if (seenUsers.size === 0) seenUsers.set(userId, 'user');
      else if (lastRole === 'user') seenUsers.set(userId, 'assistant');
      else seenUsers.set(userId, 'user');
    }
    lastRole = seenUsers.get(userId)!;
    messages.push([lastRole, text]);
  }
  return messages.length >= 2 ? messagesToTranscript(messages) : null;
}

function tryNormalizeJson(content: string): string | null {
  const jsonlResult = tryClaudeCodeJsonl(content);
  if (jsonlResult) return jsonlResult;

  const codexResult = tryCodexJsonl(content);
  if (codexResult) return codexResult;

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return null;
  }

  for (const parser of [tryClaudeAiJson, tryChatgptJson, trySlackJson]) {
    const result = parser(data);
    if (result) return result;
  }
  return null;
}

/** Normalize a file's content to transcript format. */
export async function normalizeFile(filepath: string): Promise<string> {
  const content = await readFile(filepath, 'utf-8');
  if (!content.trim()) return content;

  // Already has > markers — pass through
  const lines = content.split('\n');
  const quoteCount = lines.filter((l) => l.trim().startsWith('>')).length;
  if (quoteCount >= 3) return content;

  // Try JSON normalization
  const ext = extname(filepath).toLowerCase();
  if (
    ext === '.json' ||
    ext === '.jsonl' ||
    content.trim()[0] === '{' ||
    content.trim()[0] === '['
  ) {
    const normalized = tryNormalizeJson(content);
    if (normalized) return normalized;
  }

  return content;
}

/** Normalize raw text content (not from file). */
export function normalizeText(content: string): string {
  if (!content.trim()) return content;
  const lines = content.split('\n');
  const quoteCount = lines.filter((l) => l.trim().startsWith('>')).length;
  if (quoteCount >= 3) return content;
  if (content.trim()[0] === '{' || content.trim()[0] === '[') {
    const normalized = tryNormalizeJson(content);
    if (normalized) return normalized;
  }
  return content;
}
