import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { queryByText } from '../storage/chroma.js';

export function register(server: McpServer): void {
  server.tool(
    'mem_search',
    'Semantic search. Returns verbatim drawer content with similarity scores.',
    {
      query: z.string().describe('What to search for'),
      limit: z.number().int().positive().default(5).describe('Max results (default 5)'),
      wing: z.string().optional().describe('Filter by wing (optional)'),
      room: z.string().optional().describe('Filter by room (optional)'),
    },
    async ({ query, limit, wing, room }) => {
      const where = buildWhereFilter(wing, room);
      const results = await queryByText(query, limit, where);

      const hits = [];
      const ids = results.ids[0] ?? [];
      const docs = results.documents[0] ?? [];
      const metas = results.metadatas[0] ?? [];
      const dists = results.distances[0] ?? [];

      for (let i = 0; i < ids.length; i++) {
        hits.push({
          drawer_id: ids[i],
          content: docs[i],
          metadata: metas[i],
          similarity: dists[i] != null ? Math.round((1 - dists[i]!) * 1000) / 1000 : null,
        });
      }

      return ok({ query, results: hits, count: hits.length });
    },
  );

  server.tool(
    'mem_check_duplicate',
    'Check if content already exists in the palace before filing',
    {
      content: z.string().describe('Content to check'),
      threshold: z
        .number()
        .min(0)
        .max(1)
        .default(0.9)
        .describe('Similarity threshold 0-1 (default 0.9)'),
    },
    async ({ content, threshold }) => {
      const results = await queryByText(content, 5);
      const duplicates = [];

      const ids = results.ids[0] ?? [];
      const docs = results.documents[0] ?? [];
      const metas = results.metadatas[0] ?? [];
      const dists = results.distances[0] ?? [];

      for (let i = 0; i < ids.length; i++) {
        const dist = dists[i];
        if (dist == null) continue;
        const similarity = Math.round((1 - dist) * 1000) / 1000;
        if (similarity >= threshold) {
          const meta = metas[i];
          const doc = docs[i] ?? '';
          duplicates.push({
            id: ids[i],
            wing: meta?.wing ?? '?',
            room: meta?.room ?? '?',
            similarity,
            content: doc.length > 200 ? `${doc.slice(0, 200)}...` : doc,
          });
        }
      }

      return ok({ is_duplicate: duplicates.length > 0, matches: duplicates });
    },
  );
}

function buildWhereFilter(wing?: string, room?: string): Record<string, unknown> | undefined {
  const filters: Record<string, unknown>[] = [];
  if (wing) filters.push({ wing });
  if (room) filters.push({ room });
  if (filters.length === 0) return undefined;
  if (filters.length === 1) return filters[0];
  return { $and: filters };
}

function ok(data: Record<string, unknown>): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
