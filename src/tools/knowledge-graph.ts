import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as kg from '../storage/knowledge-graph.js';

export function register(server: McpServer): void {
  server.tool(
    'mem_kg_query',
    "Query the knowledge graph for an entity's relationships. Returns typed facts with temporal validity.",
    {
      entity: z.string().describe("Entity to query (e.g. 'Max', 'MyProject', 'Alice')"),
      as_of: z
        .string()
        .optional()
        .describe('Date filter — only facts valid at this date (YYYY-MM-DD)'),
      direction: z
        .enum(['outgoing', 'incoming', 'both'])
        .default('both')
        .describe('outgoing, incoming, or both (default: both)'),
    },
    async ({ entity, as_of, direction }) => {
      const results = await kg.queryEntity(entity, as_of, direction);
      return ok({ entity, as_of: as_of ?? null, facts: results, count: results.length });
    },
  );

  server.tool(
    'mem_kg_add',
    'Add a fact to the knowledge graph. Subject -> predicate -> object with optional time window.',
    {
      subject: z.string().describe('The entity doing/being something'),
      predicate: z.string().describe("The relationship type (e.g. 'loves', 'works_on')"),
      object: z.string().describe('The entity being connected to'),
      valid_from: z.string().optional().describe('When this became true (YYYY-MM-DD)'),
      source_closet: z.string().optional().describe('Closet ID where this fact appears'),
    },
    async ({ subject, predicate, object, valid_from, source_closet }) => {
      const tripleId = await kg.addTriple(subject, predicate, object, valid_from, source_closet);
      return ok({
        success: true,
        triple_id: tripleId,
        fact: `${subject} -> ${predicate} -> ${object}`,
      });
    },
  );

  server.tool(
    'mem_kg_invalidate',
    'Mark a fact as no longer true. E.g. ankle injury resolved, job ended, moved house.',
    {
      subject: z.string().describe('Entity'),
      predicate: z.string().describe('Relationship'),
      object: z.string().describe('Connected entity'),
      ended: z
        .string()
        .optional()
        .describe('When it stopped being true (YYYY-MM-DD, default: today)'),
    },
    async ({ subject, predicate, object, ended }) => {
      await kg.invalidate(subject, predicate, object, ended);
      return ok({
        success: true,
        fact: `${subject} -> ${predicate} -> ${object}`,
        ended: ended ?? 'today',
      });
    },
  );

  server.tool(
    'mem_kg_timeline',
    'Chronological timeline of facts. Shows the story of an entity (or everything) in order.',
    {
      entity: z.string().optional().describe('Entity to get timeline for (omit for full timeline)'),
    },
    async ({ entity }) => {
      const results = await kg.timeline(entity);
      return ok({ entity: entity ?? 'all', timeline: results, count: results.length });
    },
  );

  server.tool(
    'mem_kg_stats',
    'Knowledge graph overview: entities, triples, current vs expired facts, relationship types.',
    {},
    async () => {
      const result = await kg.stats();
      return ok(result as unknown as Record<string, unknown>);
    },
  );
}

function ok(data: Record<string, unknown>): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
