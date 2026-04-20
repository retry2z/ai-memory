/**
 * entity-registry.ts — Persistent personal entity registry.
 *
 * Knows the difference between Riley (a person) and ever (an adverb).
 * Built from three sources, in priority order:
 *   1. Onboarding — what the user explicitly told us
 *   2. Learned — what we inferred from session history with high confidence
 *   3. Researched — what we looked up via Wikipedia for unknown words
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from './logger.js';

// ── Ambiguous words (common English words that are also personal names) ──────

const COMMON_ENGLISH_WORDS = new Set([
  'ever',
  'grace',
  'will',
  'bill',
  'mark',
  'april',
  'may',
  'june',
  'joy',
  'hope',
  'faith',
  'chance',
  'chase',
  'hunter',
  'dash',
  'flash',
  'star',
  'sky',
  'river',
  'brook',
  'lane',
  'art',
  'clay',
  'gil',
  'nat',
  'max',
  'rex',
  'ray',
  'jay',
  'rose',
  'violet',
  'lily',
  'ivy',
  'ash',
  'reed',
  'sage',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'january',
  'february',
  'march',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]);

const PERSON_CONTEXT_PATTERNS = [
  '\\b{name}\\s+said\\b',
  '\\b{name}\\s+told\\b',
  '\\b{name}\\s+asked\\b',
  '\\b{name}\\s+laughed\\b',
  '\\b{name}\\s+smiled\\b',
  '\\b{name}\\s+was\\b',
  '\\b{name}\\s+is\\b',
  '\\b{name}\\s+called\\b',
  '\\b{name}\\s+texted\\b',
  '\\bwith\\s+{name}\\b',
  '\\bsaw\\s+{name}\\b',
  '\\bcalled\\s+{name}\\b',
  '\\btook\\s+{name}\\b',
  '\\bpicked\\s+up\\s+{name}\\b',
  '\\bdrop(?:ped)?\\s+(?:off\\s+)?{name}\\b',
  "\\b{name}(?:'s|s')\\b",
  '\\bhey\\s+{name}\\b',
  '\\bthanks?\\s+{name}\\b',
  '^{name}[:\\s]',
  '\\bmy\\s+(?:son|daughter|kid|child|brother|sister|friend|partner|colleague|coworker)\\s+{name}\\b',
];

const CONCEPT_CONTEXT_PATTERNS = [
  '\\bhave\\s+you\\s+{name}\\b',
  '\\bif\\s+you\\s+{name}\\b',
  '\\b{name}\\s+since\\b',
  '\\b{name}\\s+again\\b',
  '\\bnot\\s+{name}\\b',
  '\\b{name}\\s+more\\b',
  '\\bwould\\s+{name}\\b',
  '\\bcould\\s+{name}\\b',
  '\\bwill\\s+{name}\\b',
  '(?:the\\s+)?{name}\\s+(?:of|in|at|for|to)\\b',
];

// ── Types ────────────────────────────────────────────────────────────────────

interface PersonInfo {
  source: 'onboarding' | 'learned' | 'wiki';
  contexts: string[];
  aliases: string[];
  relationship: string;
  confidence: number;
  canonical?: string;
  seen_count?: number;
}

interface WikiResult {
  inferred_type: string;
  confidence: number;
  wiki_summary: string | null;
  wiki_title: string | null;
  word?: string;
  confirmed?: boolean;
  confirmed_type?: string;
  note?: string;
}

interface RegistryData {
  version: number;
  mode: string;
  people: Record<string, PersonInfo>;
  projects: string[];
  ambiguous_flags: string[];
  wiki_cache: Record<string, WikiResult>;
}

export interface LookupResult {
  type: 'person' | 'project' | 'concept' | 'unknown';
  confidence: number;
  source: string;
  name: string;
  context?: string[];
  needs_disambiguation: boolean;
  disambiguated_by?: string;
}

// ── Entity Registry ──────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function emptyData(): RegistryData {
  return {
    version: 1,
    mode: 'personal',
    people: {},
    projects: [],
    ambiguous_flags: [],
    wiki_cache: {},
  };
}

export class EntityRegistry {
  private _data: RegistryData;
  private _path: string;

  constructor(data: RegistryData, path: string) {
    this._data = data;
    this._path = path;
  }

  // ── Load / Save ──────────────────────────────────────────────────────────

  static async load(configDir?: string): Promise<EntityRegistry> {
    const { loadConfig } = await import('./config.js');
    const config = await loadConfig();
    const dir = configDir ?? config.configDir;
    const path = join(dir, 'entity_registry.json');

    if (existsSync(path)) {
      try {
        const raw = await readFile(path, 'utf-8');
        const data = JSON.parse(raw) as RegistryData;
        return new EntityRegistry(data, path);
      } catch {
        // Malformed — start fresh
      }
    }
    return new EntityRegistry(emptyData(), path);
  }

  async save(): Promise<void> {
    await mkdir(dirname(this._path), { recursive: true });
    await writeFile(this._path, JSON.stringify(this._data, null, 2));
  }

  // ── Properties ───────────────────────────────────────────────────────────

  get mode(): string {
    return this._data.mode ?? 'personal';
  }

  get people(): Record<string, PersonInfo> {
    return this._data.people ?? {};
  }

  get projects(): string[] {
    return this._data.projects ?? [];
  }

  get ambiguousFlags(): string[] {
    return this._data.ambiguous_flags ?? [];
  }

  get data(): RegistryData {
    return this._data;
  }

  // ── Seed from onboarding ─────────────────────────────────────────────────

  async seed(
    mode: string,
    people: { name: string; relationship?: string; context?: string }[],
    projects: string[],
    aliases?: Record<string, string>,
  ): Promise<void> {
    this._data.mode = mode;
    this._data.projects = [...projects];

    const reverseAliases = new Map<string, string>();
    if (aliases) {
      for (const [alias, canonical] of Object.entries(aliases)) {
        reverseAliases.set(canonical, alias);
      }
    }

    for (const entry of people) {
      const name = entry.name.trim();
      if (!name) continue;
      const context = entry.context ?? 'personal';
      const relationship = entry.relationship ?? '';

      this._data.people[name] = {
        source: 'onboarding',
        contexts: [context],
        aliases: reverseAliases.has(name) ? [reverseAliases.get(name)!] : [],
        relationship,
        confidence: 1.0,
      };

      if (reverseAliases.has(name)) {
        const alias = reverseAliases.get(name)!;
        this._data.people[alias] = {
          source: 'onboarding',
          contexts: [context],
          aliases: [name],
          relationship,
          confidence: 1.0,
          canonical: name,
        };
      }
    }

    // Flag ambiguous names
    const ambiguous: string[] = [];
    for (const name of Object.keys(this._data.people)) {
      if (COMMON_ENGLISH_WORDS.has(name.toLowerCase())) {
        ambiguous.push(name.toLowerCase());
      }
    }
    this._data.ambiguous_flags = ambiguous;

    await this.save();
  }

  // ── Lookup ───────────────────────────────────────────────────────────────

  lookup(word: string, context = ''): LookupResult {
    // 1. Exact match in people registry
    for (const [canonical, info] of Object.entries(this.people)) {
      const isMatch =
        word.toLowerCase() === canonical.toLowerCase() ||
        info.aliases.some((a) => a.toLowerCase() === word.toLowerCase());

      if (isMatch) {
        if (this.ambiguousFlags.includes(word.toLowerCase()) && context) {
          const resolved = this._disambiguate(word, context, info);
          if (resolved) return resolved;
        }
        return {
          type: 'person',
          confidence: info.confidence,
          source: info.source,
          name: canonical,
          context: info.contexts ?? ['personal'],
          needs_disambiguation: false,
        };
      }
    }

    // 2. Project match
    for (const proj of this.projects) {
      if (word.toLowerCase() === proj.toLowerCase()) {
        return {
          type: 'project',
          confidence: 1.0,
          source: 'onboarding',
          name: proj,
          needs_disambiguation: false,
        };
      }
    }

    // 3. Wiki cache
    const cache = this._data.wiki_cache ?? {};
    for (const [cachedWord, cachedResult] of Object.entries(cache)) {
      if (word.toLowerCase() === cachedWord.toLowerCase() && cachedResult.confirmed) {
        return {
          type: cachedResult.inferred_type as LookupResult['type'],
          confidence: cachedResult.confidence,
          source: 'wiki',
          name: word,
          needs_disambiguation: false,
        };
      }
    }

    return {
      type: 'unknown',
      confidence: 0.0,
      source: 'none',
      name: word,
      needs_disambiguation: false,
    };
  }

  private _disambiguate(
    word: string,
    context: string,
    personInfo: PersonInfo,
  ): LookupResult | null {
    const nameLower = word.toLowerCase();
    const ctxLower = context.toLowerCase();

    let personScore = 0;
    for (const pat of PERSON_CONTEXT_PATTERNS) {
      const regex = new RegExp(pat.replace(/\{name\}/g, escapeRegex(nameLower)), 'i');
      if (regex.test(ctxLower)) personScore++;
    }

    let conceptScore = 0;
    for (const pat of CONCEPT_CONTEXT_PATTERNS) {
      const regex = new RegExp(pat.replace(/\{name\}/g, escapeRegex(nameLower)), 'i');
      if (regex.test(ctxLower)) conceptScore++;
    }

    if (personScore > conceptScore) {
      return {
        type: 'person',
        confidence: Math.min(0.95, 0.7 + personScore * 0.1),
        source: personInfo.source,
        name: word,
        context: personInfo.contexts ?? ['personal'],
        needs_disambiguation: false,
        disambiguated_by: 'context_patterns',
      };
    } else if (conceptScore > personScore) {
      return {
        type: 'concept',
        confidence: Math.min(0.9, 0.7 + conceptScore * 0.1),
        source: 'context_disambiguated',
        name: word,
        needs_disambiguation: false,
        disambiguated_by: 'context_patterns',
      };
    }

    return null;
  }

  // ── Research via Wikipedia ───────────────────────────────────────────────

  async research(word: string, autoConfirm = false): Promise<WikiResult> {
    const cache = this._data.wiki_cache;
    if (cache[word]) return cache[word]!;

    const result = await wikipediaLookup(word);
    result.word = word;
    result.confirmed = autoConfirm;
    cache[word] = result;
    await this.save();
    return result;
  }

  async confirmResearch(
    word: string,
    entityType: string,
    relationship = '',
    context = 'personal',
  ): Promise<void> {
    const cache = this._data.wiki_cache;
    if (cache[word]) {
      cache[word]!.confirmed = true;
      cache[word]!.confirmed_type = entityType;
    }

    if (entityType === 'person') {
      this._data.people[word] = {
        source: 'wiki',
        contexts: [context],
        aliases: [],
        relationship,
        confidence: 0.9,
      };
      if (COMMON_ENGLISH_WORDS.has(word.toLowerCase())) {
        if (!this._data.ambiguous_flags.includes(word.toLowerCase())) {
          this._data.ambiguous_flags.push(word.toLowerCase());
        }
      }
    }

    await this.save();
  }

  // ── Learn from text ──────────────────────────────────────────────────────

  async learnFromText(
    text: string,
    minConfidence = 0.75,
  ): Promise<import('./entity-detector.js').DetectedEntity[]> {
    const { extractCandidates, scoreEntity, classifyEntity } = await import('./entity-detector.js');
    const lines = text.split('\n');
    const candidates = extractCandidates(text);
    const newCandidates: import('./entity-detector.js').DetectedEntity[] = [];

    for (const [name, frequency] of candidates) {
      if (name in this.people || this.projects.includes(name)) continue;
      const scores = scoreEntity(name, text, lines);
      const entity = classifyEntity(name, frequency, scores);

      if (entity.type === 'person' && entity.confidence >= minConfidence) {
        this._data.people[name] = {
          source: 'learned',
          contexts: [this.mode !== 'combo' ? this.mode : 'personal'],
          aliases: [],
          relationship: '',
          confidence: entity.confidence,
          seen_count: frequency,
        };
        if (COMMON_ENGLISH_WORDS.has(name.toLowerCase())) {
          if (!this._data.ambiguous_flags.includes(name.toLowerCase())) {
            this._data.ambiguous_flags.push(name.toLowerCase());
          }
        }
        newCandidates.push(entity);
      }
    }

    if (newCandidates.length > 0) await this.save();
    return newCandidates;
  }

  // ── Query helpers ────────────────────────────────────────────────────────

  extractPeopleFromQuery(query: string): string[] {
    const found: string[] = [];
    for (const [canonical, info] of Object.entries(this.people)) {
      const namesToCheck = [canonical, ...info.aliases];
      for (const name of namesToCheck) {
        const regex = new RegExp(`\\b${escapeRegex(name)}\\b`, 'i');
        if (regex.test(query)) {
          if (this.ambiguousFlags.includes(name.toLowerCase())) {
            const result = this._disambiguate(name, query, info);
            if (result?.type === 'person' && !found.includes(canonical)) {
              found.push(canonical);
            }
          } else if (!found.includes(canonical)) {
            found.push(canonical);
          }
        }
      }
    }
    return found;
  }

  extractUnknownCandidates(query: string): string[] {
    const matches = query.matchAll(/\b[A-Z][a-z]{2,15}\b/g);
    const unknown: string[] = [];
    const seen = new Set<string>();
    for (const m of matches) {
      const word = m[0]!;
      if (seen.has(word)) continue;
      seen.add(word);
      if (COMMON_ENGLISH_WORDS.has(word.toLowerCase())) continue;
      const result = this.lookup(word);
      if (result.type === 'unknown') unknown.push(word);
    }
    return unknown;
  }

  summary(): string {
    const peopleNames = Object.keys(this.people);
    const preview = peopleNames.slice(0, 8).join(', ');
    const suffix = peopleNames.length > 8 ? '...' : '';
    return [
      `Mode: ${this.mode}`,
      `People: ${peopleNames.length} (${preview}${suffix})`,
      `Projects: ${this.projects.join(', ') || '(none)'}`,
      `Ambiguous flags: ${this.ambiguousFlags.join(', ') || '(none)'}`,
      `Wiki cache: ${Object.keys(this._data.wiki_cache).length} entries`,
    ].join('\n');
  }
}

// ── Wikipedia lookup ─────────────────────────────────────────────────────────

const NAME_INDICATOR_PHRASES = [
  'given name',
  'personal name',
  'first name',
  'forename',
  'masculine name',
  'feminine name',
  "boy's name",
  "girl's name",
  'male name',
  'female name',
  'irish name',
  'welsh name',
  'scottish name',
  'gaelic name',
  'hebrew name',
  'arabic name',
  'norse name',
  'old english name',
  'is a name',
  'as a name',
  'name meaning',
  'name derived from',
  'legendary irish',
  'legendary welsh',
  'legendary scottish',
];

const PLACE_INDICATOR_PHRASES = [
  'city in',
  'town in',
  'village in',
  'municipality',
  'capital of',
  'district of',
  'county',
  'province',
  'region of',
  'island of',
  'mountain in',
  'river in',
];

async function wikipediaLookup(word: string): Promise<WikiResult> {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(word)}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'memorize/1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      if (resp.status === 404) {
        return {
          inferred_type: 'person',
          confidence: 0.7,
          wiki_summary: null,
          wiki_title: null,
          note: 'not found in Wikipedia — likely a proper noun or unusual name',
        };
      }
      return { inferred_type: 'unknown', confidence: 0.0, wiki_summary: null, wiki_title: null };
    }

    const data = (await resp.json()) as Record<string, unknown>;
    const pageType = (data.type as string) ?? '';
    const extract = ((data.extract as string) ?? '').toLowerCase();
    const title = (data.title as string) ?? word;

    if (pageType === 'disambiguation') {
      const desc = ((data.description as string) ?? '').toLowerCase();
      if (desc.includes('name') || desc.includes('given name')) {
        return {
          inferred_type: 'person',
          confidence: 0.65,
          wiki_summary: extract.slice(0, 200),
          wiki_title: title,
          note: 'disambiguation page with name entries',
        };
      }
      return {
        inferred_type: 'ambiguous',
        confidence: 0.4,
        wiki_summary: extract.slice(0, 200),
        wiki_title: title,
      };
    }

    if (NAME_INDICATOR_PHRASES.some((p) => extract.includes(p))) {
      const confidence =
        extract.includes(`${word.toLowerCase()} is a`) ||
        extract.includes(`${word.toLowerCase()} (name`)
          ? 0.9
          : 0.8;
      return {
        inferred_type: 'person',
        confidence,
        wiki_summary: extract.slice(0, 200),
        wiki_title: title,
      };
    }

    if (PLACE_INDICATOR_PHRASES.some((p) => extract.includes(p))) {
      return {
        inferred_type: 'place',
        confidence: 0.8,
        wiki_summary: extract.slice(0, 200),
        wiki_title: title,
      };
    }

    return {
      inferred_type: 'concept',
      confidence: 0.6,
      wiki_summary: extract.slice(0, 200),
      wiki_title: title,
    };
  } catch (err) {
    logger.debug(`Wikipedia lookup failed for "${word}": ${err}`);
    return { inferred_type: 'unknown', confidence: 0.0, wiki_summary: null, wiki_title: null };
  }
}
