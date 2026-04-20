import { createHash } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { addDocument, getByFilter } from '../storage/chroma.js';
import type { DrawerMetadata } from '../types.js';

export function register(server: McpServer): void {
  server.tool(
    'mem_diary_write',
    'Write to your personal agent diary. Your observations, thoughts, what you worked on, what matters. Each agent has their own diary with full history.',
    {
      agent_name: z.string().describe('Your name — each agent gets their own diary wing'),
      entry: z.string().describe('Your diary entry'),
      topic: z.string().default('general').describe('Topic tag (optional, default: general)'),
    },
    async ({ agent_name, entry, topic }) => {
      const wing = `wing_${agent_name.toLowerCase().replace(/ /g, '_')}`;
      const room = 'diary';
      const now = new Date();
      const hash = createHash('md5').update(entry.slice(0, 50)).digest('hex').slice(0, 8);
      const entryId = `diary_${wing}_${now.toISOString().replace(/[:.]/g, '').slice(0, 15)}_${hash}`;

      const meta: DrawerMetadata = {
        wing,
        room,
        source_file: '',
        chunk_index: 0,
        added_by: agent_name,
        filed_at: now.toISOString(),
        createdAt: now.getTime() / 1000,
        createdAt_iso: now.toISOString(),
        hall: 'hall_diary',
        topic,
        type: 'diary_entry',
        agent: agent_name,
        date: now.toISOString().split('T')[0]!,
      };

      await addDocument(entryId, entry, meta);
      return ok({
        success: true,
        entry_id: entryId,
        agent: agent_name,
        topic,
        timestamp: now.toISOString(),
      });
    },
  );

  server.tool(
    'mem_diary_read',
    'Read your recent diary entries. See what past versions of yourself recorded — your journal across sessions.',
    {
      agent_name: z.string().describe('Your name — each agent gets their own diary wing'),
      last_n: z
        .number()
        .int()
        .positive()
        .default(10)
        .describe('Number of recent entries to read (default: 10)'),
    },
    async ({ agent_name, last_n }) => {
      const wing = `wing_${agent_name.toLowerCase().replace(/ /g, '_')}`;
      const results = await getByFilter({ $and: [{ wing }, { room: 'diary' }] }, 10000);

      if (!results.ids.length) {
        return ok({ agent: agent_name, entries: [], message: 'No diary entries yet.' });
      }

      const entries = results.ids.map((_, i) => {
        const meta = results.metadatas[i];
        return {
          date: (meta?.date as string) ?? '',
          timestamp: (meta?.filed_at as string) ?? '',
          topic: (meta?.topic as string) ?? '',
          content: results.documents[i] ?? '',
        };
      });

      entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      const sliced = entries.slice(0, last_n);

      return ok({
        agent: agent_name,
        entries: sliced,
        total: results.ids.length,
        showing: sliced.length,
      });
    },
  );
}

function ok(data: Record<string, unknown>): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
