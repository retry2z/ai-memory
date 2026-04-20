import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAllMetadata } from '../storage/chroma.js';

interface RoomNode {
  room: string;
  wings: Set<string>;
  count: number;
}

async function buildGraphFromMeta(): Promise<{
  nodes: Map<string, RoomNode>;
}> {
  const allMeta = await getAllMetadata();
  const nodes = new Map<string, RoomNode>();

  for (const m of allMeta) {
    if (!m) continue;
    const room = (m.room as string) ?? 'unknown';
    const wing = (m.wing as string) ?? 'unknown';
    const existing = nodes.get(room);
    if (existing) {
      existing.wings.add(wing);
      existing.count++;
    } else {
      nodes.set(room, { room, wings: new Set([wing]), count: 1 });
    }
  }

  return { nodes };
}

export function register(server: McpServer): void {
  server.tool(
    'mem_traverse',
    'Walk the palace graph from a room. Shows connected ideas across wings.',
    {
      start_room: z.string().describe("Room to start from (e.g. 'chromadb-setup')"),
      max_hops: z
        .number()
        .int()
        .positive()
        .default(2)
        .describe('How many connections to follow (default: 2)'),
    },
    async ({ start_room, max_hops }) => {
      const { nodes } = await buildGraphFromMeta();
      const startNode = nodes.get(start_room);
      if (!startNode) {
        // Fuzzy match
        const fuzzy = [...nodes.keys()].filter(
          (k) => k.includes(start_room) || start_room.includes(k),
        );
        if (fuzzy.length === 0)
          return ok({
            error: `Room not found: ${start_room}`,
            available: [...nodes.keys()].slice(0, 20),
          });
        return ok({ error: `Room not found: ${start_room}`, did_you_mean: fuzzy.slice(0, 5) });
      }

      const visited = new Set<string>([start_room]);
      const results: Record<string, unknown>[] = [
        {
          room: start_room,
          wings: [...startNode.wings],
          count: startNode.count,
          hop: 0,
        },
      ];

      // BFS through rooms that share wings
      let frontier = [startNode];
      for (let hop = 1; hop <= max_hops; hop++) {
        const nextFrontier: RoomNode[] = [];
        for (const current of frontier) {
          for (const [name, node] of nodes) {
            if (visited.has(name)) continue;
            // Connected if they share a wing
            const shared = [...current.wings].filter((w) => node.wings.has(w));
            if (shared.length > 0) {
              visited.add(name);
              nextFrontier.push(node);
              results.push({
                room: name,
                wings: [...node.wings],
                count: node.count,
                hop,
                connected_via: shared,
              });
            }
          }
        }
        frontier = nextFrontier;
      }

      return ok({ start: start_room, results, count: results.length });
    },
  );

  server.tool(
    'mem_find_tunnels',
    'Find rooms that bridge two wings — the hallways connecting different domains.',
    {
      wing_a: z.string().optional().describe('First wing (optional)'),
      wing_b: z.string().optional().describe('Second wing (optional)'),
    },
    async ({ wing_a, wing_b }) => {
      const { nodes } = await buildGraphFromMeta();
      const tunnels: Record<string, unknown>[] = [];

      for (const [name, node] of nodes) {
        if (node.wings.size < 2) continue;
        const wingList = [...node.wings];
        if (wing_a && !wingList.includes(wing_a)) continue;
        if (wing_b && !wingList.includes(wing_b)) continue;
        tunnels.push({ room: name, wings: wingList, count: node.count });
      }

      tunnels.sort((a, b) => (b.count as number) - (a.count as number));
      return ok({ tunnels, count: tunnels.length });
    },
  );

  server.tool(
    'mem_graph_stats',
    'Palace graph overview: total rooms, tunnel connections, edges between wings.',
    {},
    async () => {
      const { nodes } = await buildGraphFromMeta();
      const totalRooms = nodes.size;
      const tunnelRooms = [...nodes.values()].filter((n) => n.wings.size > 1).length;
      const roomsPerWing: Record<string, number> = {};
      for (const node of nodes.values()) {
        for (const w of node.wings) {
          roomsPerWing[w] = (roomsPerWing[w] ?? 0) + 1;
        }
      }

      const topTunnels = [...nodes.values()]
        .filter((n) => n.wings.size > 1)
        .sort((a, b) => b.wings.size - a.wings.size)
        .slice(0, 10)
        .map((n) => ({ room: n.room, wings: [...n.wings], count: n.count }));

      return ok({
        total_rooms: totalRooms,
        tunnel_rooms: tunnelRooms,
        rooms_per_wing: roomsPerWing,
        top_tunnels: topTunnels,
      });
    },
  );
}

function ok(data: Record<string, unknown>): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
