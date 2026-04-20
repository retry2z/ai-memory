import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from './logger.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP server connected via stdio');
}

main().catch((error: unknown) => {
  logger.error('Fatal error starting MCP server', error);
  process.exit(1);
});
