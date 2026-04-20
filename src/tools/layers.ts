import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { deepSearch, layerStatus, retrieveOnDemand, wakeUp } from '../layers.js';

function ok(data: Record<string, unknown>): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function register(server: McpServer): void {
  server.tool(
    'mem_wake_up',
    'Load L0 (identity) + L1 (essential story) for context injection. This is the memory wake-up — typically ~600-900 tokens. Call at conversation start.',
    {
      wing: z.string().optional().describe('Optional wing filter for project-specific wake-up'),
    },
    async ({ wing }) => {
      const text = await wakeUp(wing);
      const tokens = Math.ceil(text.length / 4);
      return ok({ text, estimated_tokens: tokens });
    },
  );

  server.tool(
    'mem_recall',
    'On-demand L2 retrieval — load memories filtered by wing/room when a specific topic comes up.',
    {
      wing: z.string().optional().describe('Wing to filter by'),
      room: z.string().optional().describe('Room to filter by'),
      n_results: z
        .number()
        .int()
        .positive()
        .default(10)
        .describe('Max drawers to retrieve (default: 10)'),
    },
    async ({ wing, room, n_results }) => {
      const text = await retrieveOnDemand(wing, room, n_results);
      return ok({ text });
    },
  );

  server.tool(
    'mem_deep_search',
    'L3 deep semantic search across the entire palace. Unlimited depth, returns similarity scores.',
    {
      query: z.string().min(1).describe('Search query'),
      wing: z.string().optional().describe('Wing filter'),
      room: z.string().optional().describe('Room filter'),
      n_results: z.number().int().positive().default(5).describe('Max results (default: 5)'),
    },
    async ({ query, wing, room, n_results }) => {
      const text = await deepSearch(query, wing, room, n_results);
      return ok({ text });
    },
  );

  server.tool(
    'mem_layer_status',
    'Show status of all 4 memory layers — identity, essential story, on-demand, deep search.',
    {},
    async () => {
      const status = await layerStatus();
      return ok(status as unknown as Record<string, unknown>);
    },
  );
}
