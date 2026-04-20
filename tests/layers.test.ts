import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { identityTokenEstimate, loadIdentity, resetIdentityCache } from '../src/layers.js';

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'ptm-layers-test-'));
});

afterAll(() => {
  try {
    rmSync(tempDir, { recursive: true });
  } catch {
    // Windows file locking
  }
});

describe('Layers', () => {
  describe('Layer 0 — Identity', () => {
    it('should return default message when no identity file exists', async () => {
      resetIdentityCache();
      const identity = await loadIdentity(join(tempDir, 'nonexistent.txt'));
      expect(identity).toContain('No soul configured');
    });

    it('should load identity from file', async () => {
      resetIdentityCache();
      const identityPath = join(tempDir, 'identity.txt');
      writeFileSync(identityPath, 'I am Atlas, a personal AI assistant.');
      const identity = await loadIdentity(identityPath);
      expect(identity).toBe('## L0 — SOUL (Who am I?)\nI am Atlas, a personal AI assistant.');
    });

    it('should cache identity after first load', async () => {
      // Already loaded from previous test — should return cached
      const identity = await loadIdentity(join(tempDir, 'identity.txt'));
      expect(identity).toBe('## L0 — SOUL (Who am I?)\nI am Atlas, a personal AI assistant.');
    });

    it('should estimate tokens from text length', () => {
      expect(identityTokenEstimate('hello world')).toBeGreaterThan(0);
      expect(identityTokenEstimate('a'.repeat(400))).toBe(100);
    });
  });
});
