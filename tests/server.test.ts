import { describe, expect, it } from 'bun:test';
import { createServer } from '../src/server.js';

describe('createServer', () => {
  it('should return an McpServer instance', () => {
    const server = createServer();
    expect(server).toBeDefined();
  });
});
