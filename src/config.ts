import { existsSync, lstatSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface PalaceConfig {
	palacePath: string;
	collectionName: string;
	configDir: string;
	chromaUrl: string;
	kgPath: string;
}

const DEFAULT_CONFIG_DIR = join(homedir(), ".memorize");
const DEFAULT_COLLECTION_NAME = "mem_drawers";
const DEFAULT_CHROMA_URL = "http://127.0.0.1:8000";

let cachedConfig: PalaceConfig | null = null;

function findProjectConfigDir(startDir: string): string | null {
	let current = startDir;
	while (true) {
		const target = join(current, ".memorize");
		if (existsSync(target)) {
			try {
				if (lstatSync(target).isDirectory()) {
					return target;
				}
			} catch {
				// Ignore errors (e.g. permission issues)
			}
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
}

export async function loadConfig(): Promise<PalaceConfig> {
	if (cachedConfig) return cachedConfig;

	// Resolution order: env var → nearest ancestor .memorize/ → ~/.memorize/.
	// Lowercase `memorize_CONFIG_DIR` is accepted for back-compat with older
	// setups but MEMORIZE_CONFIG_DIR is the canonical name.
	const projectDir = findProjectConfigDir(process.cwd());
	const configDir =
		process.env.MEMORIZE_CONFIG_DIR ??
		process.env.memorize_CONFIG_DIR ??
		projectDir ??
		DEFAULT_CONFIG_DIR;
	const configFile = join(configDir, "config.json");

	let fileConfig: Record<string, unknown> = {};
	if (existsSync(configFile)) {
		try {
			const raw = await readFile(configFile, "utf-8");
			fileConfig = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			// Ignore malformed config — use defaults
		}
	}

	cachedConfig = {
		palacePath:
			process.env.MEMORIZE_PATH ??
			(process.env.memorize_PATH as string | undefined) ??
			(fileConfig.palace_path as string | undefined) ??
			join(configDir, "palace"),
		collectionName:
			(fileConfig.collection_name as string) ?? DEFAULT_COLLECTION_NAME,
		configDir,
		chromaUrl: process.env.CHROMA_URL ?? DEFAULT_CHROMA_URL,
		kgPath: join(configDir, "knowledge_graph.sqlite3"),
	};

	return cachedConfig;
}

/** Reset cached config — for testing only. */
export function resetConfig(): void {
	cachedConfig = null;
}
