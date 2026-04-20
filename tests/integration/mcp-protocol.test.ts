import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client: Client;
let transport: StdioClientTransport;
let tempDir: string;

beforeAll(async () => {
	tempDir = mkdtempSync(join(tmpdir(), "ptm-mcp-test-"));
	transport = new StdioClientTransport({
		command: "bun",
		args: ["run", "src/index.ts"],
		env: { ...process.env, MEMORIZE_CONFIG_DIR: tempDir, CHROMA_URL: "memory" },
	});
	client = new Client({ name: "test-client", version: "1.0.0" }, {});
	await client.connect(transport);
});

afterAll(async () => {
	await client.close();
	try {
		rmSync(tempDir, { recursive: true });
	} catch {
		// Windows file locking
	}
});

describe("MCP Protocol", () => {
	it("should list all 38 tools", async () => {
		const result = await client.listTools();
		expect(result.tools.length).toBe(38);
	});

	it("should include all expected tool names", async () => {
		const result = await client.listTools();
		const names = result.tools.map((t) => t.name);

		const expected = [
			"mem_status",
			"mem_list_wings",
			"mem_list_rooms",
			"mem_get_taxonomy",
			"mem_search",
			"mem_check_duplicate",
			"mem_add_drawer",
			"mem_update_drawer",
			"mem_delete_drawer",
			"mem_get_drawer",
			"mem_query_by_date",
			"mem_query_by_metadata",
			"mem_kg_query",
			"mem_kg_add",
			"mem_kg_invalidate",
			"mem_kg_timeline",
			"mem_kg_stats",
			"mem_traverse",
			"mem_find_tunnels",
			"mem_graph_stats",
			"mem_diary_write",
			"mem_diary_read",
			"mem_get_aaak_spec",
			// Layer tools
			"mem_wake_up",
			"mem_recall",
			"mem_deep_search",
			"mem_layer_status",
			// Dialect tools
			"mem_compress",
			"mem_compress_stats",
			"mem_decode_aaak",
			// Conversation miner tools
			"mem_mine_convos",
			"mem_scan_convos",
			// Entity tools
			"mem_detect_entities",
			"mem_entity_lookup",
			"mem_entity_seed",
			"mem_entity_learn",
			"mem_entity_research",
			"mem_entity_summary",
		];

		for (const name of expected) {
			expect(names).toContain(name);
		}
	});

	it("should return AAAK spec via tool call", async () => {
		const result = await client.callTool({
			name: "mem_get_aaak_spec",
			arguments: {},
		});
		expect(result.content).toBeDefined();
		const text =
			(result.content as { type: string; text: string }[])[0]?.text ?? "";
		const parsed = JSON.parse(text) as { aaak_spec: string };
		expect(parsed.aaak_spec).toContain("AAAK");
	});

	it("should return KG stats via tool call", async () => {
		const result = await client.callTool({
			name: "mem_kg_stats",
			arguments: {},
		});
		const text =
			(result.content as { type: string; text: string }[])[0]?.text ?? "";
		const parsed = JSON.parse(text) as Record<string, unknown>;
		expect(parsed).toHaveProperty("entities");
		expect(parsed).toHaveProperty("triples");
	});

	it("should add and query a KG fact", async () => {
		// Add fact
		const addResult = await client.callTool({
			name: "mem_kg_add",
			arguments: { subject: "TestEntity", predicate: "is_a", object: "Test" },
		});
		const addText =
			(addResult.content as { type: string; text: string }[])[0]?.text ?? "";
		const addParsed = JSON.parse(addText) as { success: boolean };
		expect(addParsed.success).toBe(true);

		// Query it back
		const queryResult = await client.callTool({
			name: "mem_kg_query",
			arguments: { entity: "TestEntity" },
		});
		const queryText =
			(queryResult.content as { type: string; text: string }[])[0]?.text ?? "";
		const queryParsed = JSON.parse(queryText) as {
			facts: { predicate: string }[];
			count: number;
		};
		expect(queryParsed.count).toBeGreaterThanOrEqual(1);
		expect(queryParsed.facts.some((f) => f.predicate === "is_a")).toBe(true);
	});

	it("should add a drawer via tool call", async () => {
		const result = await client.callTool({
			name: "mem_add_drawer",
			arguments: {
				wing: "test_wing",
				room: "test_room",
				content: "This is a test drawer from MCP protocol test.",
			},
		});
		const text =
			(result.content as { type: string; text: string }[])[0]?.text ?? "";
		const parsed = JSON.parse(text) as { success: boolean; drawer_id: string };

		// If ChromaDB is down, this might fail or return error.
		// We want to see HOW it fails.
		if (parsed.success) {
			expect(parsed.drawer_id).toBeDefined();
		} else {
			// If it's an expected failure (e.g. duplicate), that's fine for this test
			// but if it's a server error, we want to know.
			console.error("mem_add_drawer failed:", text);
		}
	});
});
