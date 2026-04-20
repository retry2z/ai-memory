import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'node20',
  external: ['bun:sqlite', 'bun:test', 'bun', 'onnxruntime-node'],
  banner: {
    js: '#!/usr/bin/env bun',
  },
});
