import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getByFilter } from '../storage/chroma.js';

export function register(server: McpServer): void {
  server.tool(
    'mem_query_by_date',
    'Query drawers by creation date range. Returns most recent first. Use to get fresh/recent memories.',
    {
      after: z
        .string()
        .optional()
        .describe("Return drawers created after this ISO date (e.g. '2026-04-01')"),
      before: z
        .string()
        .optional()
        .describe('Return drawers created before this ISO date (optional)'),
      wing: z.string().optional().describe('Filter by wing (optional)'),
      room: z.string().optional().describe('Filter by room (optional)'),
      limit: z.number().int().positive().default(50).describe('Max results (default 50)'),
    },
    async ({ after, before, wing, room, limit }) => {
      const filters: Record<string, unknown>[] = [];
      if (wing) filters.push({ wing });
      if (room) filters.push({ room });
      if (after) filters.push({ createdAt: { $gte: isoToEpoch(after) } });
      if (before) filters.push({ createdAt: { $lte: isoToEpoch(before) } });

      const where =
        filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : { $and: filters };

      const results = await getByFilter(where, Math.min(limit, 10000));

      if (!results.ids.length) {
        return ok({ results: [], count: 0 });
      }

      // Combine and sort by createdAt descending
      type Item = { id: string; doc: string; meta: Record<string, unknown> };
      const items: Item[] = results.ids.map((id, i) => ({
        id,
        doc: results.documents[i] ?? '',
        meta: (results.metadatas[i] ?? {}) as Record<string, unknown>,
      }));

      items.sort((a, b) => {
        const aTime = (a.meta.createdAt as number) ?? 0;
        const bTime = (b.meta.createdAt as number) ?? 0;
        return bTime - aTime;
      });

      const hits = items.slice(0, limit).map((item) => ({
        drawer_id: item.id,
        content: item.doc,
        metadata: item.meta,
      }));

      return ok({ results: hits, count: hits.length });
    },
  );

  server.tool(
    'mem_query_by_metadata',
    'Query drawers by a metadata key-value pair. Find drawers where a specific metadata field matches a value.',
    {
      key: z.string().describe('Metadata field name to filter on'),
      value: z.string().describe('Value to match'),
      wing: z.string().optional().describe('Filter by wing (optional)'),
      room: z.string().optional().describe('Filter by room (optional)'),
      limit: z.number().int().positive().default(50).describe('Max results (default 50)'),
    },
    async ({ key, value, wing, room, limit }) => {
      const filters: Record<string, unknown>[] = [{ [key]: value }];
      if (wing) filters.push({ wing });
      if (room) filters.push({ room });

      const where = filters.length === 1 ? filters[0] : { $and: filters };
      const results = await getByFilter(where, Math.min(limit, 10000));

      if (!results.ids.length) {
        return ok({ results: [], count: 0 });
      }

      const hits = results.ids.slice(0, limit).map((id, i) => ({
        drawer_id: id,
        content: results.documents[i] ?? '',
        metadata: results.metadatas[i] ?? {},
      }));

      return ok({ results: hits, count: hits.length });
    },
  );
}

function isoToEpoch(dateStr: string): number {
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  return parsed.getTime() / 1000;
}

function ok(data: Record<string, unknown>): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
