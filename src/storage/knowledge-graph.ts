import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { logger } from '../logger.js';
import type { KnowledgeGraphStats, Triple } from '../types.js';

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (db) return db;

  const { loadConfig } = await import('../config.js');
  const config = await loadConfig();

  db = new Database(config.kgPath);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = OFF');

  db.run(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'unknown',
      properties TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS triples (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      valid_from TEXT,
      valid_to TEXT,
      confidence REAL NOT NULL DEFAULT 1.0,
      source_closet TEXT,
      source_file TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_triples_subject ON triples(subject);
    CREATE INDEX IF NOT EXISTS idx_triples_object ON triples(object);
    CREATE INDEX IF NOT EXISTS idx_triples_predicate ON triples(predicate);
  `);

  logger.debug('Knowledge graph SQLite (Bun) initialized');
  return db;
}

function makeEntityId(name: string): string {
  return `entity_${createHash('md5').update(name.toLowerCase()).digest('hex').slice(0, 12)}`;
}

function makeTripleId(subject: string, predicate: string, object: string): string {
  // createHash imported at top level
  const key = `${subject}|${predicate}|${object}`;
  return `triple_${createHash('md5').update(key.toLowerCase()).digest('hex').slice(0, 16)}`;
}

export async function addEntity(
  name: string,
  entityType: string,
  properties: Record<string, unknown> = {},
): Promise<string> {
  const database = await getDb();
  const id = makeEntityId(name);
  database
    .query(
      `INSERT OR REPLACE INTO entities (id, name, type, properties)
       VALUES (?, ?, ?, ?)`,
    )
    .run(id, name, entityType, JSON.stringify(properties));
  return id;
}

export async function addTriple(
  subject: string,
  predicate: string,
  object: string,
  validFrom?: string,
  sourceCloset?: string,
): Promise<string> {
  const database = await getDb();
  const id = makeTripleId(subject, predicate, object);

  // Ensure entities exist
  await addEntity(subject, 'unknown');
  await addEntity(object, 'unknown');

  database
    .query(
      `INSERT OR REPLACE INTO triples (id, subject, predicate, object, valid_from, source_closet)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, subject, predicate, object, validFrom ?? null, sourceCloset ?? null);

  return id;
}

export async function invalidate(
  subject: string,
  predicate: string,
  object: string,
  ended?: string,
): Promise<void> {
  const database = await getDb();
  const endDate = ended ?? new Date().toISOString().split('T')[0];
  database
    .query(
      `UPDATE triples SET valid_to = ?
       WHERE lower(subject) = lower(?) AND lower(predicate) = lower(?) AND lower(object) = lower(?)
         AND valid_to IS NULL`,
    )
    .run(...([endDate, subject, predicate, object] as [string, string, string, string]));
}

export async function queryEntity(
  name: string,
  asOf?: string,
  direction: 'outgoing' | 'incoming' | 'both' = 'both',
): Promise<Triple[]> {
  const database = await getDb();
  const results: Triple[] = [];

  const processRows = (rows: Record<string, unknown>[]): void => {
    for (const row of rows) {
      const validTo = row.valid_to as string | null;
      const isCurrent = !validTo || (asOf ? validTo >= asOf : true);

      if (asOf) {
        const validFrom = row.valid_from as string | null;
        if (validFrom && validFrom > asOf) continue;
        if (validTo && validTo < asOf) continue;
      }

      results.push({
        id: row.id as string,
        subject: row.subject as string,
        predicate: row.predicate as string,
        object: row.object as string,
        valid_from: (row.valid_from as string) ?? null,
        valid_to: validTo ?? null,
        confidence: (row.confidence as number) ?? 1.0,
        source_closet: (row.source_closet as string) ?? null,
        current: isCurrent,
      });
    }
  };

  if (direction === 'outgoing' || direction === 'both') {
    const rows = database
      .query('SELECT * FROM triples WHERE lower(subject) = lower(?)')
      .all(name) as Record<string, unknown>[];
    processRows(rows);
  }

  if (direction === 'incoming' || direction === 'both') {
    const rows = database
      .query('SELECT * FROM triples WHERE lower(object) = lower(?)')
      .all(name) as Record<string, unknown>[];
    processRows(rows);
  }

  return results;
}

export async function timeline(entityName?: string): Promise<Triple[]> {
  const database = await getDb();
  let rows: Record<string, unknown>[];

  if (entityName) {
    rows = database
      .query(
        `SELECT * FROM triples
         WHERE lower(subject) = lower(?) OR lower(object) = lower(?)
         ORDER BY valid_from ASC`,
      )
      .all(entityName, entityName) as Record<string, unknown>[];
  } else {
    rows = database
      .query('SELECT * FROM triples ORDER BY valid_from ASC')
      .all() as Record<string, unknown>[];
  }

  return rows.map((row) => ({
    id: row.id as string,
    subject: row.subject as string,
    predicate: row.predicate as string,
    object: row.object as string,
    valid_from: (row.valid_from as string) ?? null,
    valid_to: (row.valid_to as string) ?? null,
    confidence: (row.confidence as number) ?? 1.0,
    source_closet: (row.source_closet as string) ?? null,
    current: !(row.valid_to as string | null),
  }));
}

export async function stats(): Promise<KnowledgeGraphStats> {
  const database = await getDb();

  const entityCountResult = database.query('SELECT COUNT(*) as count FROM entities').get() as {
    count: number;
  };
  const tripleCountResult = database.query('SELECT COUNT(*) as count FROM triples').get() as {
    count: number;
  };
  const currentCountResult = database
    .query('SELECT COUNT(*) as count FROM triples WHERE valid_to IS NULL')
    .get() as {
    count: number;
  };
  const predicates = (
    database.query('SELECT DISTINCT predicate FROM triples').all() as { predicate: string }[]
  ).map((r) => r.predicate);

  return {
    entities: entityCountResult.count,
    triples: tripleCountResult.count,
    current_facts: currentCountResult.count,
    expired_facts: tripleCountResult.count - currentCountResult.count,
    relationship_types: predicates,
  };
}

/** Close the database — for testing cleanup. */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
