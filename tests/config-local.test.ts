import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, resetConfig } from '../src/config.js';

describe('loadConfig local detection', () => {
  const testRoot = join(process.cwd(), 'tmp-test-root');
  const projectLocalDir = join(testRoot, '.memorize');

  beforeEach(() => {
    resetConfig();
    if (mkdirSync) {
        mkdirSync(testRoot, { recursive: true });
        mkdirSync(projectLocalDir, { recursive: true });
    }
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
    resetConfig();
  });

  it('should detect .memorize in parent directories', async () => {
    const subDir = join(testRoot, 'src', 'deep', 'path');
    mkdirSync(subDir, { recursive: true });
    
    const originalCwd = process.cwd();
    process.chdir(subDir);
    
    try {
      const config = await loadConfig();
      expect(config.configDir).toBe(projectLocalDir);
      expect(config.palacePath).toBe(join(projectLocalDir, 'palace'));
      expect(config.kgPath).toBe(join(projectLocalDir, 'knowledge_graph.sqlite3'));
    } finally {
      process.chdir(originalCwd);
    }
  });
});
