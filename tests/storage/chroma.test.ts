import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetConfig } from "../../src/config.js";
import {
	addDocument,
	getCollection,
	getDocument,
	resetCollectionCache,
} from "../../src/storage/chroma.js";

let tempDir: string;

beforeAll(() => {
	tempDir = mkdtempSync(join(tmpdir(), "ptm-chroma-test-"));
	process.env.MEMORIZE_CONFIG_DIR = tempDir;
	process.env.CHROMA_URL = "memory";
	resetConfig();
	resetCollectionCache();
});

afterAll(() => {
	try {
		rmSync(tempDir, { recursive: true });
	} catch {
		// Windows
	}
});

describe("ChromaDB Storage", () => {
	it("should get or create a collection", async () => {
		const col = await getCollection(true);
		expect(col).not.toBeNull();
	});

	it("should add and get a document", async () => {
		const id = "test-doc-1";
		const content = "This is a test document content.";
		const metadata = {
			wing: "test-wing",
			room: "test-room",
			drawer: "test-drawer",
			createdAt: Date.now(),
			tokens: 10,
		};

		await addDocument(id, content, metadata);
		const doc = await getDocument(id);

		expect(doc).not.toBeNull();
		expect(doc?.id).toBe(id);
		expect(doc?.content).toBe(content);
		expect(doc?.metadata.wing).toBe("test-wing");
	});
});
