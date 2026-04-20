import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let tempDir: string;
let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
	tempDir = mkdtempSync(join(tmpdir(), "memorize-perf-test-"));

	transport = new StdioClientTransport({
		command: "bun",
		args: ["run", "src/index.ts"],
		env: {
			...process.env,
			MEMORIZE_CONFIG_DIR: tempDir,
			CHROMA_URL: "memory",
			MEM_LOG_LEVEL: "error",
		},
	});

	client = new Client({ name: "perf-client", version: "1.0.0" }, {});
	await client.connect(transport);
});

afterAll(async () => {
	await client.close();
	try {
		rmSync(tempDir, { recursive: true });
	} catch {
		// Windows issues
	}
});

async function bench(name: string, fn: () => Promise<any>, iterations = 10) {
	// Warmup
	await fn();

	const start = performance.now();
	for (let i = 0; i < iterations; i++) {
		await fn();
	}
	const end = performance.now();
	const avg = (end - start) / iterations;
	console.log(
		`PERF: [${name}] Avg: ${avg.toFixed(3)}ms (over ${iterations} iterations)`,
	);
	return avg;
}

describe("Tool Performance", () => {
	it("measures mem_add_drawer performance", async () => {
		let i = 0;
		await bench(
			"mem_add_drawer",
			async () => {
				await client.callTool({
					name: "mem_add_drawer",
					arguments: {
						wing: "perf-wing",
						room: "perf-room",
						content: `This is performance test content ${i++}. It should be unique enough.`,
						metadata: { iteration: i },
					},
				});
			},
			20,
		);
	});

	it("measures mem_get_drawer performance", async () => {
		const res = (await client.callTool({
			name: "mem_add_drawer",
			arguments: {
				wing: "perf-wing",
				room: "get-perf",
				content: "Constant content for get",
			},
		})) as any;

		const text =
			(res.content as { type: string; text: string }[])[0]?.text ?? "{}";
		const drawer_id = JSON.parse(text).drawer_id;

		await bench(
			"mem_get_drawer",
			async () => {
				await client.callTool({
					name: "mem_get_drawer",
					arguments: { drawer_id },
				});
			},
			50,
		);
	});

	it("measures mem_search performance", async () => {
		// Seed some data first
		for (let i = 0; i < 10; i++) {
			await client.callTool({
				name: "mem_add_drawer",
				arguments: {
					wing: "search-wing",
					room: "search-room",
					content: `Content for search iteration ${i}. Keyword: banana.`,
				},
			});
		}

		await bench(
			"mem_search",
			async () => {
				await client.callTool({
					name: "mem_search",
					arguments: { query: "banana", limit: 5 },
				});
			},
			20,
		);
	});

	it("measures mem_kg_add performance", async () => {
		let i = 0;
		await bench(
			"mem_kg_add",
			async () => {
				await client.callTool({
					name: "mem_kg_add",
					arguments: {
						subject: `Entity_${i++}`,
						predicate: "works_with",
						object: `Entity_${i + 1}`,
					},
				});
			},
			50,
		);
	});

	it("measures mem_kg_query performance", async () => {
		await client.callTool({
			name: "mem_kg_add",
			arguments: {
				subject: "Alpha",
				predicate: "is",
				object: "First",
			},
		});

		await bench(
			"mem_kg_query",
			async () => {
				await client.callTool({
					name: "mem_kg_query",
					arguments: { entity: "Alpha" },
				});
			},
			50,
		);
	});

	it("measures mem_diary_write performance", async () => {
		let i = 0;
		await bench(
			"mem_diary_write",
			async () => {
				await client.callTool({
					name: "mem_diary_write",
					arguments: {
						agent_name: "test-agent",
						entry: `Log entry ${i++}`,
						topic: "performance",
					},
				});
			},
			20,
		);
	});

	it("measures mem_update_drawer performance", async () => {
		const res = (await client.callTool({
			name: "mem_add_drawer",
			arguments: {
				wing: "perf-wing",
				room: "update-perf",
				content: "Original content",
			},
		})) as any;
		const text =
			(res.content as { type: string; text: string }[])[0]?.text ?? "{}";
		const drawer_id = JSON.parse(text).drawer_id;

		await bench(
			"mem_update_drawer",
			async () => {
				await client.callTool({
					name: "mem_update_drawer",
					arguments: { drawer_id, content: "Updated content" },
				});
			},
			20,
		);
	});

	it("measures mem_delete_drawer performance", async () => {
		await bench(
			"mem_delete_drawer",
			async () => {
				const res = (await client.callTool({
					name: "mem_add_drawer",
					arguments: {
						wing: "perf-wing",
						room: "delete-perf",
						content: "Content to be deleted",
					},
				})) as any;
				const text =
					(res.content as { type: string; text: string }[])[0]?.text ?? "{}";
				const drawer_id = JSON.parse(text).drawer_id;

				await client.callTool({
					name: "mem_delete_drawer",
					arguments: { drawer_id },
				});
			},
			10,
		);
	});

	it("measures mem_kg_stats performance", async () => {
		await bench(
			"mem_kg_stats",
			async () => {
				await client.callTool({ name: "mem_kg_stats", arguments: {} });
			},
			50,
		);
	});

	it("measures mem_status performance", async () => {
		await bench(
			"mem_status",
			async () => {
				await client.callTool({ name: "mem_status", arguments: {} });
			},
			50,
		);
	});

	it("measures mem_compress performance", async () => {
		const text =
			"This is a long piece of text that needs to be compressed into the AAAK dialect. It contains various entities like Alice and Bob who are working on the Memory Project.";
		await bench(
			"mem_compress",
			async () => {
				await client.callTool({
					name: "mem_compress",
					arguments: { text },
				});
			},
			10,
		);
	});

	it("measures mem_entity_lookup performance", async () => {
		await bench(
			"mem_entity_lookup",
			async () => {
				await client.callTool({
					name: "mem_entity_lookup",
					arguments: { word: "Alice" },
				});
			},
			50,
		);
	});

	it("measures mem_graph_stats performance", async () => {
		await bench(
			"mem_graph_stats",
			async () => {
				await client.callTool({ name: "mem_graph_stats", arguments: {} });
			},
			50,
		);
	});

	it("measures mem_query_by_metadata performance", async () => {
		await bench(
			"mem_query_by_metadata",
			async () => {
				await client.callTool({
					name: "mem_query_by_metadata",
					arguments: { key: "wing", value: "perf-wing" },
				});
			},
			50,
		);
	});

	it("measures mem_traverse performance", async () => {
		await bench(
			"mem_traverse",
			async () => {
				await client.callTool({
					name: "mem_traverse",
					arguments: { start_room: "perf-room" },
				});
			},
			20,
		);
	});

	it("measures mem_get_aaak_spec performance", async () => {
		await bench(
			"mem_get_aaak_spec",
			async () => {
				await client.callTool({ name: "mem_get_aaak_spec", arguments: {} });
			},
			50,
		);
	});
});
