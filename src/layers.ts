/**
 * layers.ts — 4-Layer Memory Stack
 *
 *   Layer 0: Identity       (~100 tokens)   — Always loaded. "Who am I?"
 *   Layer 1: Essential Story (~500-800)      — Always loaded. Top moments from the palace.
 *   Layer 2: On-Demand      (~200-500 each)  — Loaded when a topic/wing comes up.
 *   Layer 3: Deep Search    (unlimited)      — Full ChromaDB semantic search.
 *
 * Wake-up cost: ~600-900 tokens (L0+L1). Leaves 95%+ of context free.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { IncludeEnum } from 'chromadb';
import { getByFilter, getCollection, getCount, queryByText } from './storage/chroma.js';

// ── Layer 0: Identity ────────────────────────────────────────────────────────

const GLOBAL_SOUL_PATH = join(homedir(), '.memorize', 'soul.md');

let cachedIdentity: string | null = null;

export async function loadIdentity(identityPath?: string): Promise<string> {
  if (cachedIdentity !== null) return cachedIdentity;

  const { loadConfig } = await import('./config.js');
  const config = await loadConfig();

  const searchPaths = [
    identityPath,
    join(process.cwd(), 'soul.md'),
    join(process.cwd(), 'doc', 'soul.md'),
    join(process.cwd(), 'docs', 'soul.md'),
    join(config.configDir, 'soul.md'),
    join(process.cwd(), '.memorize', 'soul.md'),
    join(process.cwd(), '.agents', 'soul.md'),
    GLOBAL_SOUL_PATH,
  ].filter((p): p is string => !!p);

  for (const path of searchPaths) {
    if (existsSync(path)) {
      try {
        const content = (await readFile(path, 'utf-8')).trim();
        if (content) {
          cachedIdentity = `## L0 — SOUL (Who am I?)\n${content}`;
          return cachedIdentity;
        }
      } catch {
        // Continue to next path
      }
    }
  }

  cachedIdentity =
    '## L0 — SOUL (Who am I?)\nNo soul configured. Create soul.md in workspace, .memorize/ folder, or ~/.memorize/soul.md';
  return cachedIdentity;
}

export function identityTokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Layer 1: Essential Story ─────────────────────────────────────────────────

const MAX_DRAWERS = 15;
const MAX_CHARS = 3200;
const BATCH_SIZE = 500;

export async function generateEssentialStory(wing?: string): Promise<string> {
  const col = await getCollection();
  if (!col) return '## L1 — No palace found. Run: memorize mine <dir>';

  // Fetch all drawers in batches (avoids SQLite ~999 variable limit)
  const docs: (string | null)[] = [];
  const metas: (Record<string, string | number | boolean> | null)[] = [];
  let offset = 0;

  while (true) {
    const params: Record<string, unknown> = {
      include: ['documents' as IncludeEnum, 'metadatas' as IncludeEnum],
      limit: BATCH_SIZE,
      offset,
    };
    if (wing) params.where = { wing };

    let batch: {
      documents: (string | null)[];
      metadatas: (Record<string, string | number | boolean> | null)[];
    };
    try {
      batch = (await col.get(params)) as unknown as typeof batch;
    } catch {
      break;
    }

    if (!batch.documents || batch.documents.length === 0) break;
    docs.push(...batch.documents);
    metas.push(...batch.metadatas);
    offset += batch.documents.length;
    if (batch.documents.length < BATCH_SIZE) break;
  }

  if (docs.length === 0) return '## L1 — No memories yet.';

  // Score each drawer — prefer high importance, recent filing
  const scored: {
    importance: number;
    meta: Record<string, string | number | boolean>;
    doc: string;
  }[] = [];
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const meta = metas[i];
    if (!doc || !meta) continue;

    let importance = 3;
    for (const key of ['importance', 'emotional_weight', 'weight']) {
      const val = meta[key];
      if (val !== undefined && val !== null) {
        const parsed = Number(val);
        if (!Number.isNaN(parsed)) importance = parsed;
        break;
      }
    }

    scored.push({ importance, meta, doc });
  }

  // Sort by importance descending, take top N
  scored.sort((a, b) => b.importance - a.importance);
  const top = scored.slice(0, MAX_DRAWERS);

  // Group by room
  const byRoom = new Map<string, typeof top>();
  for (const entry of top) {
    const room = (entry.meta.room as string) ?? 'general';
    if (!byRoom.has(room)) byRoom.set(room, []);
    byRoom.get(room)!.push(entry);
  }

  // Build compact text
  const lines = ['## L1 — ESSENTIAL STORY'];
  let totalLen = 0;

  for (const [room, entries] of [...byRoom.entries()].sort()) {
    const roomLine = `\n[${room}]`;
    lines.push(roomLine);
    totalLen += roomLine.length;

    for (const { meta, doc } of entries) {
      const sourceFile = meta.source_file as string | undefined;
      const source = sourceFile ? basename(sourceFile) : '';

      let snippet = doc.trim().replace(/\n/g, ' ');
      if (snippet.length > 200) snippet = snippet.slice(0, 197) + '...';

      let entryLine = `  - ${snippet}`;
      if (source) entryLine += `  (${source})`;

      if (totalLen + entryLine.length > MAX_CHARS) {
        lines.push('  ... (more in L3 search)');
        return lines.join('\n');
      }

      lines.push(entryLine);
      totalLen += entryLine.length;
    }
  }

  return lines.join('\n');
}

// ── Layer 2: On-Demand ───────────────────────────────────────────────────────

export async function retrieveOnDemand(
  wing?: string,
  room?: string,
  nResults = 10,
): Promise<string> {
  let where: Record<string, unknown> | undefined;
  if (wing && room) where = { $and: [{ wing }, { room }] };
  else if (wing) where = { wing };
  else if (room) where = { room };

  const results = await getByFilter(where, nResults);
  const { ids, documents: docs, metadatas: metas } = results;

  if (!ids.length) {
    const label = [wing ? `wing=${wing}` : '', room ? `room=${room}` : '']
      .filter(Boolean)
      .join(' ');
    return `No drawers found for ${label}.`;
  }

  const lines = [`## L2 — ON-DEMAND (${ids.length} drawers)`];
  for (let i = 0; i < Math.min(ids.length, nResults); i++) {
    const doc = docs[i];
    const meta = metas[i];
    const roomName = (meta?.room as string) ?? '?';
    const sourceFile = meta?.source_file as string | undefined;
    const source = sourceFile ? basename(sourceFile) : '';

    let snippet = (doc ?? '').trim().replace(/\n/g, ' ');
    if (snippet.length > 300) snippet = snippet.slice(0, 297) + '...';

    let entry = `  [${roomName}] ${snippet}`;
    if (source) entry += `  (${source})`;
    lines.push(entry);
  }

  return lines.join('\n');
}

// ── Layer 3: Deep Search ─────────────────────────────────────────────────────

export async function deepSearch(
  query: string,
  wing?: string,
  room?: string,
  nResults = 5,
): Promise<string> {
  let where: Record<string, unknown> | undefined;
  if (wing && room) where = { $and: [{ wing }, { room }] };
  else if (wing) where = { wing };
  else if (room) where = { room };

  const results = await queryByText(query, nResults, where);
  const docs = results.documents[0] ?? [];
  const metasArr = results.metadatas[0] ?? [];
  const dists = results.distances[0] ?? [];

  if (docs.length === 0) return 'No results found.';

  const lines = [`## L3 — SEARCH RESULTS for "${query}"`];
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const meta = metasArr[i];
    const dist = dists[i];

    const similarity = dist != null ? Math.round((1 - dist) * 1000) / 1000 : null;
    const wingName = (meta?.wing as string) ?? '?';
    const roomName = (meta?.room as string) ?? '?';
    const sourceFile = meta?.source_file as string | undefined;
    const source = sourceFile ? basename(sourceFile) : '';

    let snippet = (doc ?? '').trim().replace(/\n/g, ' ');
    if (snippet.length > 300) snippet = snippet.slice(0, 297) + '...';

    lines.push(`  [${i + 1}] ${wingName}/${roomName} (sim=${similarity})`);
    lines.push(`      ${snippet}`);
    if (source) lines.push(`      src: ${source}`);
  }

  return lines.join('\n');
}

export interface DeepSearchHit {
  text: string;
  wing: string;
  room: string;
  source_file: string;
  similarity: number;
  metadata: Record<string, string | number | boolean> | null;
}

export async function deepSearchRaw(
  query: string,
  wing?: string,
  room?: string,
  nResults = 5,
): Promise<DeepSearchHit[]> {
  let where: Record<string, unknown> | undefined;
  if (wing && room) where = { $and: [{ wing }, { room }] };
  else if (wing) where = { wing };
  else if (room) where = { room };

  const results = await queryByText(query, nResults, where);
  const docs = results.documents[0] ?? [];
  const metasArr = results.metadatas[0] ?? [];
  const dists = results.distances[0] ?? [];

  const hits: DeepSearchHit[] = [];
  for (let i = 0; i < docs.length; i++) {
    const meta = metasArr[i];
    hits.push({
      text: docs[i] ?? '',
      wing: (meta?.wing as string) ?? 'unknown',
      room: (meta?.room as string) ?? 'unknown',
      source_file: meta?.source_file ? basename(String(meta.source_file)) : '?',
      similarity: dists[i] != null ? Math.round((1 - dists[i]!) * 1000) / 1000 : 0,
      metadata: meta ?? null,
    });
  }
  return hits;
}

// ── Wake-up (L0 + L1 combined) ──────────────────────────────────────────────

export async function wakeUp(wing?: string, identityPath?: string): Promise<string> {
  const identity = await loadIdentity(identityPath);
  const essential = await generateEssentialStory(wing);
  return `${identity}\n\n${essential}`;
}

// ── Status ───────────────────────────────────────────────────────────────────

export interface LayerStatus {
  palace_path: string;
  L0_identity: { path: string; exists: boolean; tokens: number };
  L1_essential: { description: string };
  L2_on_demand: { description: string };
  L3_deep_search: { description: string };
  total_drawers: number;
}

export async function layerStatus(identityPath?: string): Promise<LayerStatus> {
  const path = identityPath ?? GLOBAL_SOUL_PATH;
  const identity = await loadIdentity(identityPath);
  const { loadConfig } = await import('./config.js');
  const config = await loadConfig();
  const count = await getCount();

  return {
    palace_path: config.palacePath,
    L0_identity: {
      path,
      exists: existsSync(path),
      tokens: identityTokenEstimate(identity),
    },
    L1_essential: { description: 'Auto-generated from top palace drawers' },
    L2_on_demand: { description: 'Wing/room filtered retrieval' },
    L3_deep_search: { description: 'Full semantic search via ChromaDB' },
    total_drawers: count,
  };
}

/** Reset cached identity — for testing. */
export function resetIdentityCache(): void {
  cachedIdentity = null;
}
