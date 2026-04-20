import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from './logger.js';
import { register as registerAaak } from './tools/aaak.js';
import { register as registerConvoMiner } from './tools/convo-miner.js';
import { register as registerDialect } from './tools/dialect.js';
import { register as registerDiary } from './tools/diary.js';
import { register as registerDrawers } from './tools/drawers.js';
import { register as registerEntities } from './tools/entities.js';
import { register as registerGraph } from './tools/graph.js';
import { register as registerKg } from './tools/knowledge-graph.js';
import { register as registerLayers } from './tools/layers.js';
import { register as registerQuery } from './tools/query.js';
import { register as registerSearch } from './tools/search.js';
import { register as registerStatus } from './tools/status.js';

const VERSION = '0.2.0';

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'memorize', version: VERSION },
    { capabilities: { tools: {} } },
  );

  registerStatus(server);
  registerSearch(server);
  registerDrawers(server);
  registerQuery(server);
  registerKg(server);
  registerGraph(server);
  registerDiary(server);
  registerAaak(server);
  registerLayers(server);
  registerDialect(server);
  registerConvoMiner(server);
  registerEntities(server);

  logger.info(`Memorize MCP server v${VERSION} — 38 tools registered`);
  return server;
}
