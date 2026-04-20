import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { EntityRegistry } from '../src/entity-registry.js';

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'ptm-entity-test-'));
});

afterAll(() => {
  try {
    rmSync(tempDir, { recursive: true });
  } catch {
    // Windows file locking
  }
});

describe('Entity Registry', () => {
  it('should load empty registry when no file exists', async () => {
    const registry = await EntityRegistry.load(tempDir);
    expect(Object.keys(registry.people)).toHaveLength(0);
    expect(registry.projects).toHaveLength(0);
    expect(registry.mode).toBe('personal');
  });

  it('should seed and save registry', async () => {
    const registry = await EntityRegistry.load(tempDir);
    await registry.seed(
      'personal',
      [
        { name: 'Alice', relationship: 'friend', context: 'personal' },
        { name: 'Bob', relationship: 'colleague', context: 'work' },
      ],
      ['memorize', 'AcmeApp'],
    );

    expect(Object.keys(registry.people)).toContain('Alice');
    expect(Object.keys(registry.people)).toContain('Bob');
    expect(registry.projects).toContain('memorize');
    expect(registry.projects).toContain('AcmeApp');
  });

  it('should persist and reload registry', async () => {
    const registry = await EntityRegistry.load(tempDir);
    expect(Object.keys(registry.people)).toContain('Alice');
    expect(registry.projects).toContain('memorize');
  });

  it('should lookup known person', async () => {
    const registry = await EntityRegistry.load(tempDir);
    const result = registry.lookup('Alice');
    expect(result.type).toBe('person');
    expect(result.confidence).toBe(1.0);
    expect(result.source).toBe('onboarding');
  });

  it('should lookup known project', async () => {
    const registry = await EntityRegistry.load(tempDir);
    const result = registry.lookup('memorize');
    expect(result.type).toBe('project');
    expect(result.confidence).toBe(1.0);
  });

  it('should return unknown for unregistered word', async () => {
    const registry = await EntityRegistry.load(tempDir);
    const result = registry.lookup('Zxyqwf');
    expect(result.type).toBe('unknown');
    expect(result.confidence).toBe(0.0);
  });

  it('should handle ambiguous names with context', async () => {
    const registry = await EntityRegistry.load(tempDir);
    await registry.seed('personal', [{ name: 'Grace', relationship: 'daughter' }], []);

    // With person context
    const personResult = registry.lookup('Grace', 'I saw Grace at the park');
    expect(personResult.type).toBe('person');

    // With concept context
    const conceptResult = registry.lookup('Grace', 'the grace of the architecture');
    expect(conceptResult.type).toBe('concept');
  });

  it('should extract people from query', async () => {
    const registry = await EntityRegistry.load(tempDir);
    const found = registry.extractPeopleFromQuery('Alice went to lunch with Bob');
    expect(found).toContain('Alice');
    expect(found).toContain('Bob');
  });

  it('should extract unknown candidates from query', async () => {
    const registry = await EntityRegistry.load(tempDir);
    const unknown = registry.extractUnknownCandidates('Charlie met with Alice yesterday');
    expect(unknown).toContain('Charlie');
    expect(unknown).not.toContain('Alice');
  });

  it('should generate summary', async () => {
    const registry = await EntityRegistry.load(tempDir);
    const summary = registry.summary();
    expect(summary).toContain('Mode:');
    expect(summary).toContain('People:');
    expect(summary).toContain('Projects:');
  });
});
