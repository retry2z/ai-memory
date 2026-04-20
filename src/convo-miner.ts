/**
 * convo-miner.ts — Mine conversations into the palace.
 *
 * Ingests chat exports (Claude Code, ChatGPT, Slack, plain text transcripts).
 * Normalizes format, chunks by exchange pair (Q+A = one unit), files to palace.
 */

import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { logger } from "./logger.js";
import { normalizeFile } from "./normalize.js";
import { addDocument, getByFilter } from "./storage/chroma.js";
import type { DrawerMetadata } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const CONVO_EXTENSIONS = new Set([".txt", ".md", ".json", ".jsonl"]);

// Skip well-known non-source directories. `.memorize` prevents recursive
// mining of the palace itself. We deliberately do NOT skip `memory` as a
// bare name — it's overly broad and clashes with legitimate content dirs
// like `.agents/memory/` that users may want to mine.
const SKIP_DIRS = new Set([
	".git",
	"node_modules",
	"__pycache__",
	".venv",
	"venv",
	"env",
	"dist",
	"build",
	".next",
	".memorize",
	"tool-results",
]);

const MIN_CHUNK_SIZE = 30;

// ── Topic detection ──────────────────────────────────────────────────────────

const TOPIC_KEYWORDS: Record<string, string[]> = {
	technical: [
		"code",
		"python",
		"function",
		"bug",
		"error",
		"api",
		"database",
		"server",
		"deploy",
		"git",
		"test",
		"debug",
		"refactor",
	],
	architecture: [
		"architecture",
		"design",
		"pattern",
		"structure",
		"schema",
		"interface",
		"module",
		"component",
		"service",
		"layer",
	],
	planning: [
		"plan",
		"roadmap",
		"milestone",
		"deadline",
		"priority",
		"sprint",
		"backlog",
		"scope",
		"requirement",
		"spec",
	],
	decisions: [
		"decided",
		"chose",
		"picked",
		"switched",
		"migrated",
		"replaced",
		"trade-off",
		"alternative",
		"option",
		"approach",
	],
	problems: [
		"problem",
		"issue",
		"broken",
		"failed",
		"crash",
		"stuck",
		"workaround",
		"fix",
		"solved",
		"resolved",
	],
};

export function detectConvoRoom(content: string): string {
	const contentLower = content.slice(0, 3000).toLowerCase();
	const scores = new Map<string, number>();

	for (const [room, keywords] of Object.entries(TOPIC_KEYWORDS)) {
		let score = 0;
		for (const kw of keywords) {
			if (contentLower.includes(kw)) score++;
		}
		if (score > 0) scores.set(room, score);
	}

	if (scores.size > 0) {
		let maxRoom = "general";
		let maxScore = 0;
		for (const [room, score] of scores) {
			if (score > maxScore) {
				maxScore = score;
				maxRoom = room;
			}
		}
		return maxRoom;
	}
	return "general";
}

// ── Chunking ─────────────────────────────────────────────────────────────────

export interface Chunk {
	content: string;
	chunk_index: number;
}

export function chunkExchanges(content: string): Chunk[] {
	const lines = content.split("\n");
	const quoteLines = lines.filter((l) => l.trim().startsWith(">")).length;

	if (quoteLines >= 3) return chunkByExchange(lines);
	return chunkByParagraph(content);
}

function chunkByExchange(lines: string[]): Chunk[] {
	const chunks: Chunk[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i]!;
		if (line.trim().startsWith(">")) {
			const userTurn = line.trim();
			i++;

			const aiLines: string[] = [];
			while (i < lines.length) {
				const nextLine = lines[i]!;
				if (
					nextLine.trim().startsWith(">") ||
					nextLine.trim().startsWith("---")
				)
					break;
				if (nextLine.trim()) aiLines.push(nextLine.trim());
				i++;
			}

			const aiResponse = aiLines.slice(0, 8).join(" ");
			const chunkContent = aiResponse ? `${userTurn}\n${aiResponse}` : userTurn;

			if (chunkContent.trim().length > MIN_CHUNK_SIZE) {
				chunks.push({ content: chunkContent, chunk_index: chunks.length });
			}
		} else {
			i++;
		}
	}

	return chunks;
}

function chunkByParagraph(content: string): Chunk[] {
	const chunks: Chunk[] = [];
	const paragraphs = content
		.split("\n\n")
		.map((p) => p.trim())
		.filter(Boolean);

	// If no paragraph breaks and long content, chunk by line groups
	if (paragraphs.length <= 1 && content.split("\n").length > 20) {
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i += 25) {
			const group = lines
				.slice(i, i + 25)
				.join("\n")
				.trim();
			if (group.length > MIN_CHUNK_SIZE) {
				chunks.push({ content: group, chunk_index: chunks.length });
			}
		}
		return chunks;
	}

	for (const para of paragraphs) {
		if (para.length > MIN_CHUNK_SIZE) {
			chunks.push({ content: para, chunk_index: chunks.length });
		}
	}
	return chunks;
}

// ── File scanning ────────────────────────────────────────────────────────────

export async function scanConvos(convoDir: string): Promise<string[]> {
	const files: string[] = [];

	async function walk(dir: string): Promise<void> {
		let entries: import("node:fs").Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) await walk(join(dir, entry.name));
			} else {
				if (entry.name.endsWith(".meta.json")) continue;
				const ext = extname(entry.name).toLowerCase();
				if (CONVO_EXTENSIONS.has(ext)) files.push(join(dir, entry.name));
			}
		}
	}

	await walk(convoDir);
	return files;
}

async function fileAlreadyMined(sourceFile: string): Promise<boolean> {
	try {
		const results = await getByFilter({ source_file: sourceFile }, 1);
		return results.ids.length > 0;
	} catch {
		return false;
	}
}

// ── Mine conversations ───────────────────────────────────────────────────────

export interface MineOptions {
	wing?: string;
	agent?: string;
	limit?: number;
	dryRun?: boolean;
}

export interface MineResult {
	filesProcessed: number;
	filesSkipped: number;
	drawersAdded: number;
	roomCounts: Record<string, number>;
}

export async function mineConvos(
	convoDir: string,
	options: MineOptions = {},
): Promise<MineResult> {
	const {
		wing: wingOverride,
		agent = "memorize",
		limit = 0,
		dryRun = false,
	} = options;

	// Default wing from directory name
	const dirName =
		convoDir.split(/[/\\]/).filter(Boolean).pop() ?? "conversations";
	const wing = wingOverride ?? dirName.toLowerCase().replace(/[\s-]/g, "_");

	let files = await scanConvos(convoDir);
	if (limit > 0) files = files.slice(0, limit);

	logger.info(`Mining ${files.length} conversation files into wing=${wing}`);

	let totalDrawers = 0;
	let filesSkipped = 0;
	let filesProcessed = 0;
	const roomCounts: Record<string, number> = {};

	for (const filepath of files) {
		// Skip if already filed
		if (!dryRun && (await fileAlreadyMined(filepath))) {
			filesSkipped++;
			continue;
		}

		// Normalize format
		let content: string;
		try {
			content = await normalizeFile(filepath);
		} catch {
			continue;
		}

		if (!content || content.trim().length < MIN_CHUNK_SIZE) continue;

		// Chunk into exchange pairs
		const chunks = chunkExchanges(content);
		if (chunks.length === 0) continue;

		// Detect room from content
		const room = detectConvoRoom(content);
		roomCounts[room] = (roomCounts[room] ?? 0) + 1;

		if (dryRun) {
			totalDrawers += chunks.length;
			filesProcessed++;
			continue;
		}

		// File each chunk
		let drawersAdded = 0;
		const now = new Date();
		for (const chunk of chunks) {
			const drawerId = `drawer_${wing}_${room}_${createHash("md5")
				.update(filepath + String(chunk.chunk_index))
				.digest("hex")
				.slice(0, 16)}`;

			const meta: DrawerMetadata = {
				wing,
				room,
				source_file: filepath,
				chunk_index: chunk.chunk_index,
				added_by: agent,
				filed_at: now.toISOString(),
				createdAt: now.getTime() / 1000,
				createdAt_iso: now.toISOString(),
				ingest_mode: "convos",
			};

			try {
				await addDocument(drawerId, chunk.content, meta);
				drawersAdded++;
			} catch (err) {
				const errMsg = String(err);
				if (!errMsg.toLowerCase().includes("already exists")) throw err;
			}
		}

		totalDrawers += drawersAdded;
		filesProcessed++;
	}

	return {
		filesProcessed,
		filesSkipped,
		drawersAdded: totalDrawers,
		roomCounts,
	};
}
