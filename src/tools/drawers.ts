import { createHash } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  addDocument,
  deleteDocument,
  getDocument,
  queryByText,
  updateDocument,
} from '../storage/chroma.js';
import type { DrawerMetadata } from '../types.js';

export function register(server: McpServer): void {
  server.tool(
    'mem_add_drawer',
    'Store content into the palace with automatic createdAt timestamp. Supports arbitrary JSON metadata. Checks for duplicates first.',
    {
      wing: z.string().describe('Wing (project/category name)'),
      room: z.string().describe('Room (aspect: backend, decisions, meetings...)'),
      content: z.string().describe('Content to store'),
      source_file: z.string().optional().describe('Where this came from (optional)'),
      added_by: z.string().default('mcp').describe('Who is filing this (default: mcp)'),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Arbitrary key-value metadata'),
    },
    async ({ wing, room, content, source_file, added_by, metadata }) => {
      // Duplicate check
      const dupResult = await queryByText(content, 5);
      const dupIds = dupResult.ids[0] ?? [];
      const dupDists = dupResult.distances[0] ?? [];
      const dupMetas = dupResult.metadatas[0] ?? [];
      const dupDocs = dupResult.documents[0] ?? [];
      const duplicates = [];
      for (let i = 0; i < dupIds.length; i++) {
        const dist = dupDists[i];
        if (dist == null) continue;
        const sim = Math.round((1 - dist) * 1000) / 1000;
        if (sim >= 0.9) {
          duplicates.push({
            id: dupIds[i],
            wing: dupMetas[i]?.wing ?? '?',
            room: dupMetas[i]?.room ?? '?',
            similarity: sim,
            content: (dupDocs[i] ?? '').slice(0, 200),
          });
        }
      }
      if (duplicates.length > 0) {
        return ok({ success: false, reason: 'duplicate', matches: duplicates });
      }

      const now = new Date();
      const hash = createHash('md5')
        .update(content.slice(0, 100) + now.toISOString())
        .digest('hex')
        .slice(0, 16);
      const drawerId = `drawer_${wing}_${room}_${hash}`;

      const meta: DrawerMetadata = {
        wing,
        room,
        source_file: source_file ?? '',
        chunk_index: 0,
        added_by,
        filed_at: now.toISOString(),
        createdAt: now.getTime() / 1000,
        createdAt_iso: now.toISOString(),
      };

      // Merge user metadata — flatten complex values
      if (metadata) {
        for (const [k, v] of Object.entries(metadata)) {
          if (['wing', 'room', 'createdAt', 'filed_at'].includes(k)) continue;
          if (typeof v === 'object' && v !== null) {
            meta[k] = JSON.stringify(v);
          } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            meta[k] = v;
          } else {
            meta[k] = String(v);
          }
        }
      }

      try {
        await addDocument(drawerId, content, meta);
        return ok({ success: true, drawer_id: drawerId, wing, room, createdAt: meta.createdAt_iso });
      } catch (error) {
        return ok({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          hint: 'Ensure ChromaDB server is running at http://127.0.0.1:8000',
        });
      }
    },
  );

  server.tool(
    'mem_update_drawer',
    'Update an existing drawer content and/or metadata. Only provided fields are changed.',
    {
      drawer_id: z.string().describe('ID of the drawer to update'),
      content: z.string().optional().describe('New content (optional)'),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Metadata fields to update/add'),
    },
    async ({ drawer_id, content, metadata }) => {
      try {
        const existing = await getDocument(drawer_id);
        if (!existing) return ok({ success: false, error: `Drawer not found: ${drawer_id}` });

        const now = new Date();
        const newContent = content ?? existing.content;
        const newMeta = { ...existing.metadata };
        newMeta.updatedAt = now.getTime() / 1000;
        newMeta.updatedAt_iso = now.toISOString();

        if (metadata) {
          for (const [k, v] of Object.entries(metadata)) {
            if (['createdAt', 'filed_at'].includes(k)) continue;
            if (typeof v === 'object' && v !== null) {
              newMeta[k] = JSON.stringify(v);
            } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
              newMeta[k] = v;
            } else {
              newMeta[k] = String(v);
            }
          }
        }

        await updateDocument(drawer_id, newContent, newMeta);
        return ok({ success: true, drawer_id, updatedAt: newMeta.updatedAt });
      } catch (error) {
        return ok({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          hint: 'Ensure ChromaDB server is running at http://127.0.0.1:8000',
        });
      }
    },
  );

  server.tool(
    'mem_delete_drawer',
    'Delete a drawer by ID. Irreversible.',
    {
      drawer_id: z.string().describe('ID of the drawer to delete'),
    },
    async ({ drawer_id }) => {
      try {
        const existing = await getDocument(drawer_id);
        if (!existing) return ok({ success: false, error: `Drawer not found: ${drawer_id}` });
        await deleteDocument(drawer_id);
        return ok({ success: true, drawer_id });
      } catch (error) {
        return ok({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          hint: 'Ensure ChromaDB server is running at http://127.0.0.1:8000',
        });
      }
    },
  );

  server.tool(
    'mem_get_drawer',
    'Get a single drawer by ID with full content and metadata.',
    {
      drawer_id: z.string().describe('ID of the drawer to retrieve'),
    },
    async ({ drawer_id }) => {
      const existing = await getDocument(drawer_id);
      if (!existing) return ok({ error: `Drawer not found: ${drawer_id}` });
      return ok({
        drawer_id: existing.id,
        content: existing.content,
        metadata: existing.metadata,
      });
    },
  );
}

function ok(data: Record<string, unknown>): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
