import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Dialect } from '../dialect.js';

function ok(data: Record<string, unknown>): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function register(server: McpServer): void {
  server.tool(
    'mem_compress',
    'Compress plain text into AAAK Dialect format. Lossy summarization that extracts entities, topics, key quotes, emotions, and flags into a compact symbolic representation.',
    {
      text: z.string().min(1).describe('Plain text to compress'),
      wing: z.string().optional().describe('Wing metadata for header'),
      room: z.string().optional().describe('Room metadata for header'),
      source_file: z.string().optional().describe('Source file path for header'),
      date: z.string().optional().describe('Date for header'),
      entities: z
        .record(z.string(), z.string())
        .optional()
        .describe('Entity name->code mappings (e.g. {"Alice": "ALC"})'),
    },
    async ({ text, wing, room, source_file, date, entities }) => {
      const dialect = new Dialect(entities);
      const compressed = dialect.compress(text, { wing, room, source_file, date });
      const stats = dialect.compressionStats(text, compressed);
      return ok({ compressed, stats });
    },
  );

  server.tool(
    'mem_compress_stats',
    'Get compression statistics for a text-to-AAAK conversion. Shows token estimates and size ratio.',
    {
      original_text: z.string().min(1).describe('Original text'),
      compressed_text: z.string().min(1).describe('AAAK compressed text'),
    },
    async ({ original_text, compressed_text }) => {
      const dialect = new Dialect();
      const stats = dialect.compressionStats(original_text, compressed_text);
      return ok(stats as unknown as Record<string, unknown>);
    },
  );

  server.tool(
    'mem_decode_aaak',
    'Parse an AAAK Dialect string back into a structured summary with header, arc, zettels, and tunnels.',
    {
      dialect_text: z.string().min(1).describe('AAAK Dialect formatted text'),
    },
    async ({ dialect_text }) => {
      const dialect = new Dialect();
      const decoded = dialect.decode(dialect_text);
      return ok(decoded as unknown as Record<string, unknown>);
    },
  );
}
