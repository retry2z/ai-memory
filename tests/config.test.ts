import { afterEach, describe, expect, it } from "bun:test";
import { loadConfig, resetConfig } from "../src/config.js";

describe("loadConfig", () => {
	afterEach(() => {
		resetConfig();
		delete process.env.MEMORIZE_PATH;
		delete process.env.MEMORIZE_CONFIG_DIR;
		delete process.env.memorize_PATH;
		delete process.env.memorize_CONFIG_DIR;
		delete process.env.CHROMA_URL;
	});

	it("should return default config when no env vars or files exist", async () => {
		const config = await loadConfig();
		expect(config.collectionName).toBe("mem_drawers");
		expect(config.chromaUrl).toBe("http://127.0.0.1:8000");
		expect(config.palacePath).toContain(".memorize");
		expect(config.kgPath).toContain("knowledge_graph.sqlite3");
	});

	it("should respect MEMORIZE_PATH env var", async () => {
		process.env.MEMORIZE_PATH = "/tmp/test-palace";
		const config = await loadConfig();
		expect(config.palacePath).toBe("/tmp/test-palace");
	});

	it("should honor the legacy lowercase memorize_PATH env var as fallback", async () => {
		// Note: Windows env vars are case-insensitive — MEMORIZE_PATH and
		// memorize_PATH are the same variable there. This test still passes
		// on Windows but only exercises the distinct lowercase fallback
		// branch on POSIX systems.
		process.env.memorize_PATH = "/tmp/legacy-palace";
		const config = await loadConfig();
		expect(config.palacePath).toBe("/tmp/legacy-palace");
	});

	it("should respect CHROMA_URL env var", async () => {
		process.env.CHROMA_URL = "http://chroma:9000";
		const config = await loadConfig();
		expect(config.chromaUrl).toBe("http://chroma:9000");
	});

	it("should cache config across calls", async () => {
		const config1 = await loadConfig();
		const config2 = await loadConfig();
		expect(config1).toBe(config2);
	});
});
