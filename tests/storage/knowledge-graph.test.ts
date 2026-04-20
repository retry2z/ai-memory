import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetConfig } from "../../src/config.js";
import {
	addEntity,
	addTriple,
	closeDb,
	invalidate,
	queryEntity,
	stats,
	timeline,
} from "../../src/storage/knowledge-graph.js";

let tempDir: string;

beforeAll(() => {
	tempDir = mkdtempSync(join(tmpdir(), "ptm-kg-test-"));
	process.env.MEMORIZE_CONFIG_DIR = tempDir;
	resetConfig();
});

afterAll(() => {
	closeDb();
	try {
		rmSync(tempDir, { recursive: true });
	} catch {
		// Windows file locking — harmless
	}
});

describe("Knowledge Graph", () => {
	it("should add an entity", async () => {
		const id = await addEntity("Alice", "person", { role: "protagonist" });
		expect(id).toMatch(/^entity_/);
	});

	it("should add a triple", async () => {
		const id = await addTriple("Alice", "loves", "Bob", "2026-01-01");
		expect(id).toMatch(/^triple_/);
	});

	it("should query entity relationships", async () => {
		const results = await queryEntity("Alice");
		expect(results.length).toBeGreaterThanOrEqual(1);
		const loveFact = results.find((r) => r.predicate === "loves");
		expect(loveFact).toBeDefined();
		expect(loveFact?.object).toBe("Bob");
		expect(loveFact?.current).toBe(true);
	});

	it("should query with direction filter", async () => {
		const outgoing = await queryEntity("Alice", undefined, "outgoing");
		expect(outgoing.some((r) => r.predicate === "loves")).toBe(true);

		const incoming = await queryEntity("Alice", undefined, "incoming");
		expect(incoming.some((r) => r.predicate === "loves")).toBe(false);

		const incomingBob = await queryEntity("Bob", undefined, "incoming");
		expect(incomingBob.some((r) => r.subject === "Alice")).toBe(true);
	});

	it("should invalidate a fact", async () => {
		await addTriple("Alice", "works_at", "Acme", "2025-01-01");
		await invalidate("Alice", "works_at", "Acme", "2026-03-01");

		const results = await queryEntity("Alice");
		const workFact = results.find((r) => r.predicate === "works_at");
		expect(workFact).toBeDefined();
		expect(workFact?.valid_to).toBe("2026-03-01");
	});

	it("should filter by as_of date", async () => {
		// Alice works_at Acme from 2025-01-01 to 2026-03-01
		const beforeEnd = await queryEntity("Alice", "2026-01-15");
		const workFact = beforeEnd.find((r) => r.predicate === "works_at");
		expect(workFact).toBeDefined();

		const afterEnd = await queryEntity("Alice", "2026-06-01");
		const expired = afterEnd.find((r) => r.predicate === "works_at");
		expect(expired).toBeUndefined();
	});

	it("should return timeline", async () => {
		const tl = await timeline("Alice");
		expect(tl.length).toBeGreaterThanOrEqual(2);
		// Should be sorted by valid_from
	});

	it("should return full timeline when no entity specified", async () => {
		const tl = await timeline();
		expect(tl.length).toBeGreaterThanOrEqual(2);
	});

	it("should return stats", async () => {
		const s = await stats();
		expect(s.entities).toBeGreaterThanOrEqual(2);
		expect(s.triples).toBeGreaterThanOrEqual(2);
		expect(s.relationship_types).toContain("loves");
		expect(s.current_facts).toBeGreaterThanOrEqual(1);
		expect(s.expired_facts).toBeGreaterThanOrEqual(1);
	});
});
