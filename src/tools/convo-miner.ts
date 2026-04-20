import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mineConvos, scanConvos } from '../convo-miner.js';

function ok(data: Record<string, unknown>): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function register(server: McpServer): void {
  server.tool(
    'mem_mine_convos',
    'Mine a directory of conversation files into the palace. Supports Claude Code JSONL, ChatGPT JSON, Slack exports, and plain text transcripts. Chunks by exchange pairs (Q+A = one unit).',
    {
      directory: z.string().min(1).describe('Path to directory containing conversation files'),
      wing: z.string().optional().describe('Wing to file into (defaults to directory name)'),
      agent: z.string().default('memorize').describe('Agent name for added_by metadata'),
      limit: z.number().int().nonnegative().default(0).describe('Max files to process (0 = all)'),
      dry_run: z
        .boolean()
        .default(false)
        .describe('Preview what would be filed without actually filing'),
    },
    async ({ directory, wing, agent, limit, dry_run }) => {
      const result = await mineConvos(directory, {
        wing,
        agent,
        limit,
        dryRun: dry_run,
      });
      return ok({
        success: true,
        dry_run,
        files_processed: result.filesProcessed,
        files_skipped: result.filesSkipped,
        drawers_added: result.drawersAdded,
        room_counts: result.roomCounts,
      });
    },
  );

  server.tool(
    'mem_scan_convos',
    'Scan a directory for conversation files without mining them. Returns file paths and counts.',
    {
      directory: z.string().min(1).describe('Path to directory to scan'),
    },
    async ({ directory }) => {
      const files = await scanConvos(directory);
      return ok({
        directory,
        file_count: files.length,
        files: files.slice(0, 50),
        truncated: files.length > 50,
      });
    },
  );
}
