import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { detectEntitiesFromTexts, scanForDetection } from '../entity-detector.js';
import { EntityRegistry } from '../entity-registry.js';

function ok(data: Record<string, unknown>): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function register(server: McpServer): void {
  server.tool(
    'mem_detect_entities',
    'Auto-detect people and projects from files in a directory. Two-pass approach: scans for entity candidates, then scores and classifies each as person, project, or uncertain.',
    {
      directory: z.string().min(1).describe('Directory to scan for entities'),
      max_files: z
        .number()
        .int()
        .positive()
        .default(10)
        .describe('Max files to read (default: 10)'),
    },
    async ({ directory, max_files }) => {
      const texts = await scanForDetection(directory, max_files);
      const result = detectEntitiesFromTexts(texts);
      return ok({
        people: result.people,
        projects: result.projects,
        uncertain: result.uncertain,
        total_candidates: result.people.length + result.projects.length + result.uncertain.length,
      });
    },
  );

  server.tool(
    'mem_entity_lookup',
    'Look up a word in the entity registry. Returns type (person/project/concept/unknown) with confidence and source.',
    {
      word: z.string().min(1).describe('Word to look up'),
      context: z
        .string()
        .default('')
        .describe('Surrounding sentence for disambiguation of ambiguous words'),
    },
    async ({ word, context }) => {
      const registry = await EntityRegistry.load();
      const result = registry.lookup(word, context);
      return ok(result as unknown as Record<string, unknown>);
    },
  );

  server.tool(
    'mem_entity_seed',
    'Seed the entity registry from onboarding data. Provide known people and projects.',
    {
      mode: z.enum(['personal', 'work', 'combo']).default('personal').describe('Registry mode'),
      people: z
        .array(
          z.object({
            name: z.string().min(1),
            relationship: z.string().optional(),
            context: z.string().optional(),
          }),
        )
        .describe('List of known people'),
      projects: z.array(z.string()).default([]).describe('List of known projects'),
      aliases: z
        .record(z.string(), z.string())
        .optional()
        .describe('Alias mappings (e.g. {"Max": "Maxwell"})'),
    },
    async ({ mode, people, projects, aliases }) => {
      const registry = await EntityRegistry.load();
      await registry.seed(mode, people, projects, aliases);
      return ok({
        success: true,
        mode,
        people_count: Object.keys(registry.people).length,
        projects_count: registry.projects.length,
        ambiguous_flags: registry.ambiguousFlags,
      });
    },
  );

  server.tool(
    'mem_entity_learn',
    'Learn new entities from text. Scans for person candidates and auto-adds high-confidence matches to the registry.',
    {
      text: z.string().min(1).describe('Text to scan for entities'),
      min_confidence: z
        .number()
        .min(0)
        .max(1)
        .default(0.75)
        .describe('Minimum confidence threshold (default: 0.75)'),
    },
    async ({ text, min_confidence }) => {
      const registry = await EntityRegistry.load();
      const newEntities = await registry.learnFromText(text, min_confidence);
      return ok({
        success: true,
        new_entities: newEntities,
        total_people: Object.keys(registry.people).length,
      });
    },
  );

  server.tool(
    'mem_entity_research',
    'Research an unknown word via Wikipedia to determine if it is a person, place, or concept.',
    {
      word: z.string().min(1).describe('Word to research'),
      auto_confirm: z
        .boolean()
        .default(false)
        .describe('Auto-confirm the result without user review'),
    },
    async ({ word, auto_confirm }) => {
      const registry = await EntityRegistry.load();
      const result = await registry.research(word, auto_confirm);
      return ok(result as unknown as Record<string, unknown>);
    },
  );

  server.tool(
    'mem_entity_summary',
    'Get a summary of the entity registry — known people, projects, ambiguous flags, and wiki cache.',
    {},
    async () => {
      const registry = await EntityRegistry.load();
      return ok({
        summary: registry.summary(),
        people: Object.keys(registry.people),
        projects: registry.projects,
        ambiguous_flags: registry.ambiguousFlags,
        wiki_cache_size: Object.keys(registry.data.wiki_cache).length,
      });
    },
  );
}
