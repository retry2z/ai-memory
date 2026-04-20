import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { getAllMetadata, getCount } from "../storage/chroma.js";
import { AAAK_SPEC, PALACE_PROTOCOL } from "./aaak.js";

export function register(server: McpServer): void {
	server.tool(
		"mem_status",
		"Palace overview — total drawers, wing and room counts",
		{},
		async () => {
			const count = await getCount();
			if (count === 0) return nopalace();

			const allMeta = await getAllMetadata();
			const wings: Record<string, number> = {};
			const rooms: Record<string, number> = {};
			for (const m of allMeta) {
				if (!m) continue;
				const w = (m.wing as string) ?? "unknown";
				const r = (m.room as string) ?? "unknown";
				wings[w] = (wings[w] ?? 0) + 1;
				rooms[r] = (rooms[r] ?? 0) + 1;
			}

			const config = await loadConfig();
			const storageMode =
				config.chromaUrl === "memory" || config.chromaUrl === "mock"
					? "volatile (in-memory)"
					: "persistent (chromadb)";

			return ok({
				total_drawers: count,
				wings,
				rooms,
				palace_path: config.palacePath,
				vector_storage: storageMode,
				protocol: PALACE_PROTOCOL,
				aaak_dialect: AAAK_SPEC,
			});
		},
	);

	server.tool(
		"mem_list_wings",
		"List all wings with drawer counts",
		{},
		async () => {
			const allMeta = await getAllMetadata();
			if (!allMeta.length) return nopalace();
			const wings: Record<string, number> = {};
			for (const m of allMeta) {
				if (!m) continue;
				const w = (m.wing as string) ?? "unknown";
				wings[w] = (wings[w] ?? 0) + 1;
			}
			return ok({ wings });
		},
	);

	server.tool(
		"mem_list_rooms",
		"List rooms within a wing (or all rooms if no wing given)",
		{ wing: z.string().optional() },
		async ({ wing }) => {
			const allMeta = await getAllMetadata();
			if (!allMeta.length) return nopalace();
			const rooms: Record<string, number> = {};
			for (const m of allMeta) {
				if (!m) continue;
				if (wing && m.wing !== wing) continue;
				const r = (m.room as string) ?? "unknown";
				rooms[r] = (rooms[r] ?? 0) + 1;
			}
			return ok({ wing: wing ?? "all", rooms });
		},
	);

	server.tool(
		"mem_get_taxonomy",
		"Full taxonomy: wing -> room -> drawer count",
		{},
		async () => {
			const allMeta = await getAllMetadata();
			if (!allMeta.length) return nopalace();
			const taxonomy: Record<string, Record<string, number>> = {};
			for (const m of allMeta) {
				if (!m) continue;
				const w = (m.wing as string) ?? "unknown";
				const r = (m.room as string) ?? "unknown";
				if (!taxonomy[w]) taxonomy[w] = {};
				taxonomy[w]![r] = (taxonomy[w]?.[r] ?? 0) + 1;
			}
			return ok({ taxonomy });
		},
	);
}

function ok(data: Record<string, unknown>): {
	content: { type: "text"; text: string }[];
} {
	return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function nopalace(): { content: { type: "text"; text: string }[] } {
	return ok({
		error: "No palace found",
		hint: "The palace is created on first write. Run: memorize mine <dir>  (or use mem_add_drawer).",
	});
}
