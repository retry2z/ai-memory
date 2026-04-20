// ── Drawer metadata as stored in ChromaDB ─────────────────────────────────────

export interface DrawerMetadata {
	wing: string;
	room: string;
	source_file: string;
	chunk_index: number;
	added_by: string;
	filed_at: string;
	createdAt: number; // epoch float — ChromaDB needs numeric for $gte/$lte
	createdAt_iso: string;
	updatedAt?: number;
	updatedAt_iso?: string;
	[key: string]: string | number | boolean | undefined;
}

export interface Drawer {
	drawer_id: string;
	content: string;
	metadata: DrawerMetadata;
}

// ── Knowledge graph types ─────────────────────────────────────────────────────

export interface Entity {
	id: string;
	name: string;
	entity_type: string;
	properties: Record<string, unknown>;
}

export interface Triple {
	id: string;
	subject: string;
	predicate: string;
	object: string;
	valid_from: string | null;
	valid_to: string | null;
	confidence: number;
	source_closet: string | null;
	current: boolean;
}

export interface KnowledgeGraphStats {
	entities: number;
	triples: number;
	current_facts: number;
	expired_facts: number;
	relationship_types: string[];
}
