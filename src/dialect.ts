/**
 * dialect.ts — AAAK Dialect: Structured Symbolic Summary Format
 *
 * Lossy summarization that extracts entities, topics, key sentences,
 * emotions, and flags from plain text into a compact structured representation.
 * Any LLM reads it natively.
 */

import { basename } from 'node:path';

// ── Emotion codes ────────────────────────────────────────────────────────────

const EMOTION_CODES: Record<string, string> = {
  vulnerability: 'vul',
  vulnerable: 'vul',
  joy: 'joy',
  joyful: 'joy',
  fear: 'fear',
  mild_fear: 'fear',
  trust: 'trust',
  trust_building: 'trust',
  grief: 'grief',
  raw_grief: 'grief',
  wonder: 'wonder',
  philosophical_wonder: 'wonder',
  rage: 'rage',
  anger: 'rage',
  love: 'love',
  devotion: 'love',
  hope: 'hope',
  despair: 'despair',
  hopelessness: 'despair',
  peace: 'peace',
  relief: 'relief',
  humor: 'humor',
  dark_humor: 'humor',
  tenderness: 'tender',
  raw_honesty: 'raw',
  brutal_honesty: 'raw',
  self_doubt: 'doubt',
  anxiety: 'anx',
  exhaustion: 'exhaust',
  conviction: 'convict',
  quiet_passion: 'passion',
  warmth: 'warmth',
  curiosity: 'curious',
  gratitude: 'grat',
  frustration: 'frust',
  confusion: 'confuse',
  satisfaction: 'satis',
  excitement: 'excite',
  determination: 'determ',
  surprise: 'surprise',
};

const EMOTION_SIGNALS: Record<string, string> = {
  decided: 'determ',
  prefer: 'convict',
  worried: 'anx',
  excited: 'excite',
  frustrated: 'frust',
  confused: 'confuse',
  love: 'love',
  hate: 'rage',
  hope: 'hope',
  fear: 'fear',
  trust: 'trust',
  happy: 'joy',
  sad: 'grief',
  surprised: 'surprise',
  grateful: 'grat',
  curious: 'curious',
  wonder: 'wonder',
  anxious: 'anx',
  relieved: 'relief',
  satisf: 'satis',
  disappoint: 'grief',
  concern: 'anx',
};

const FLAG_SIGNALS: Record<string, string> = {
  decided: 'DECISION',
  chose: 'DECISION',
  switched: 'DECISION',
  migrated: 'DECISION',
  replaced: 'DECISION',
  'instead of': 'DECISION',
  because: 'DECISION',
  founded: 'ORIGIN',
  created: 'ORIGIN',
  started: 'ORIGIN',
  born: 'ORIGIN',
  launched: 'ORIGIN',
  'first time': 'ORIGIN',
  core: 'CORE',
  fundamental: 'CORE',
  essential: 'CORE',
  principle: 'CORE',
  belief: 'CORE',
  always: 'CORE',
  'never forget': 'CORE',
  'turning point': 'PIVOT',
  'changed everything': 'PIVOT',
  realized: 'PIVOT',
  breakthrough: 'PIVOT',
  epiphany: 'PIVOT',
  api: 'TECHNICAL',
  database: 'TECHNICAL',
  architecture: 'TECHNICAL',
  deploy: 'TECHNICAL',
  infrastructure: 'TECHNICAL',
  algorithm: 'TECHNICAL',
  framework: 'TECHNICAL',
  server: 'TECHNICAL',
  config: 'TECHNICAL',
};

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'about',
  'between',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'up',
  'down',
  'out',
  'off',
  'over',
  'under',
  'again',
  'further',
  'then',
  'once',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'all',
  'each',
  'every',
  'both',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'just',
  'don',
  'now',
  'and',
  'but',
  'or',
  'if',
  'while',
  'that',
  'this',
  'these',
  'those',
  'it',
  'its',
  'i',
  'we',
  'you',
  'he',
  'she',
  'they',
  'me',
  'him',
  'her',
  'us',
  'them',
  'my',
  'your',
  'his',
  'our',
  'their',
  'what',
  'which',
  'who',
  'whom',
  'also',
  'much',
  'many',
  'like',
  'because',
  'since',
  'get',
  'got',
  'use',
  'used',
  'using',
  'make',
  'made',
  'thing',
  'things',
  'way',
  'well',
  'really',
  'want',
  'need',
]);

// ── Types ────────────────────────────────────────────────────────────────────

interface CompressMetadata {
  source_file?: string;
  wing?: string;
  room?: string;
  date?: string;
}

export interface CompressionStats {
  original_tokens_est: number;
  summary_tokens_est: number;
  size_ratio: number;
  original_chars: number;
  summary_chars: number;
  note: string;
}

interface DecodedDialect {
  header: Record<string, string>;
  arc: string;
  zettels: string[];
  tunnels: string[];
}

// ── Dialect class ────────────────────────────────────────────────────────────

export class Dialect {
  private entityCodes: Map<string, string>;
  private skipNames: string[];

  constructor(entities?: Record<string, string>, skipNames?: string[]) {
    this.entityCodes = new Map();
    if (entities) {
      for (const [name, code] of Object.entries(entities)) {
        this.entityCodes.set(name, code);
        this.entityCodes.set(name.toLowerCase(), code);
      }
    }
    this.skipNames = (skipNames ?? []).map((n) => n.toLowerCase());
  }

  // ── Encoding primitives ──────────────────────────────────────────────────

  encodeEntity(name: string): string | null {
    if (this.skipNames.some((s) => name.toLowerCase().includes(s))) return null;
    if (this.entityCodes.has(name)) return this.entityCodes.get(name)!;
    if (this.entityCodes.has(name.toLowerCase())) return this.entityCodes.get(name.toLowerCase())!;
    for (const [key, code] of this.entityCodes) {
      if (name.toLowerCase().includes(key.toLowerCase())) return code;
    }
    return name.slice(0, 3).toUpperCase();
  }

  encodeEmotions(emotions: string[]): string {
    const codes: string[] = [];
    for (const e of emotions) {
      const code = EMOTION_CODES[e] ?? e.slice(0, 4);
      if (!codes.includes(code)) codes.push(code);
    }
    return codes.slice(0, 3).join('+');
  }

  // ── Text analysis ────────────────────────────────────────────────────────

  private detectEmotions(text: string): string[] {
    const textLower = text.toLowerCase();
    const detected: string[] = [];
    const seen = new Set<string>();
    for (const [keyword, code] of Object.entries(EMOTION_SIGNALS)) {
      if (textLower.includes(keyword) && !seen.has(code)) {
        detected.push(code);
        seen.add(code);
      }
    }
    return detected.slice(0, 3);
  }

  private detectFlags(text: string): string[] {
    const textLower = text.toLowerCase();
    const detected: string[] = [];
    const seen = new Set<string>();
    for (const [keyword, flag] of Object.entries(FLAG_SIGNALS)) {
      if (textLower.includes(keyword) && !seen.has(flag)) {
        detected.push(flag);
        seen.add(flag);
      }
    }
    return detected.slice(0, 3);
  }

  private extractTopics(text: string, maxTopics = 3): string[] {
    const words = text.match(/[a-zA-Z][a-zA-Z_-]{2,}/g) ?? [];
    const freq = new Map<string, number>();

    for (const w of words) {
      const wLower = w.toLowerCase();
      if (STOP_WORDS.has(wLower) || wLower.length < 3) continue;
      freq.set(wLower, (freq.get(wLower) ?? 0) + 1);
    }

    // Boost proper nouns and technical terms
    for (const w of words) {
      const wLower = w.toLowerCase();
      if (STOP_WORDS.has(wLower)) continue;
      if (w[0]!.toUpperCase() === w[0] && freq.has(wLower)) {
        freq.set(wLower, freq.get(wLower)! + 2);
      }
      if ((w.includes('_') || w.includes('-') || /[A-Z]/.test(w.slice(1))) && freq.has(wLower)) {
        freq.set(wLower, freq.get(wLower)! + 2);
      }
    }

    const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    return ranked.slice(0, maxTopics).map(([w]) => w);
  }

  private extractKeySentence(text: string): string {
    const sentences = text
      .split(/[.!?\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);
    if (sentences.length === 0) return '';

    const decisionWords = new Set([
      'decided',
      'because',
      'instead',
      'prefer',
      'switched',
      'chose',
      'realized',
      'important',
      'key',
      'critical',
      'discovered',
      'learned',
      'conclusion',
      'solution',
      'reason',
      'why',
      'breakthrough',
      'insight',
    ]);

    const scored = sentences.map((s) => {
      let score = 0;
      const sLower = s.toLowerCase();
      for (const w of decisionWords) {
        if (sLower.includes(w)) score += 2;
      }
      if (s.length < 80) score += 1;
      if (s.length < 40) score += 1;
      if (s.length > 150) score -= 2;
      return { score, text: s };
    });

    scored.sort((a, b) => b.score - a.score);
    let best = scored[0]!.text;
    if (best.length > 55) best = best.slice(0, 52) + '...';
    return best;
  }

  private detectEntitiesInText(text: string): string[] {
    const found: string[] = [];

    // Check known entities
    for (const [name, code] of this.entityCodes) {
      if (!/[A-Z]/.test(name[0] ?? '')) continue; // skip lowercase keys
      if (text.toLowerCase().includes(name.toLowerCase())) {
        if (!found.includes(code)) found.push(code);
      }
    }
    if (found.length > 0) return found;

    // Fallback: find capitalized words that look like names
    const words = text.split(/\s+/);
    for (let i = 1; i < words.length; i++) {
      const w = words[i]!;
      const clean = w.replace(/[^a-zA-Z]/g, '');
      if (
        clean.length >= 2 &&
        clean[0]!.toUpperCase() === clean[0] &&
        clean.slice(1) === clean.slice(1).toLowerCase() &&
        !STOP_WORDS.has(clean.toLowerCase())
      ) {
        const code = clean.slice(0, 3).toUpperCase();
        if (!found.includes(code)) found.push(code);
        if (found.length >= 3) break;
      }
    }
    return found;
  }

  // ── Main compression ─────────────────────────────────────────────────────

  compress(text: string, metadata?: CompressMetadata): string {
    const meta = metadata ?? {};

    const entities = this.detectEntitiesInText(text);
    const entityStr = entities.length > 0 ? entities.slice(0, 3).join('+') : '???';

    const topics = this.extractTopics(text);
    const topicStr = topics.length > 0 ? topics.slice(0, 3).join('_') : 'misc';

    const quote = this.extractKeySentence(text);
    const quotePart = quote ? `"${quote}"` : '';

    const emotions = this.detectEmotions(text);
    const emotionStr = emotions.join('+');

    const flags = this.detectFlags(text);
    const flagStr = flags.join('+');

    const lines: string[] = [];

    // Header line
    if (meta.source_file || meta.wing) {
      const headerParts = [
        meta.wing ?? '?',
        meta.room ?? '?',
        meta.date ?? '?',
        meta.source_file ? basename(meta.source_file).replace(/\.[^.]+$/, '') : '?',
      ];
      lines.push(headerParts.join('|'));
    }

    // Content line
    const parts = [`0:${entityStr}`, topicStr];
    if (quotePart) parts.push(quotePart);
    if (emotionStr) parts.push(emotionStr);
    if (flagStr) parts.push(flagStr);

    lines.push(parts.join('|'));

    return lines.join('\n');
  }

  // ── Zettel-based encoding (original format) ──────────────────────────────

  getFlags(zettel: Record<string, unknown>): string {
    const flags: string[] = [];
    if (zettel.origin_moment) flags.push('ORIGIN');
    if (
      typeof zettel.sensitivity === 'string' &&
      zettel.sensitivity.toUpperCase().startsWith('MAXIMUM')
    )
      flags.push('SENSITIVE');
    const notes = ((zettel.notes as string) ?? '').toLowerCase();
    if (notes.includes('foundational pillar') || notes.includes('core')) flags.push('CORE');
    if (
      notes.includes('genesis') ||
      ((zettel.origin_label as string) ?? '').toLowerCase().includes('genesis')
    )
      flags.push('GENESIS');
    if (notes.includes('pivot')) flags.push('PIVOT');
    return flags.join('+');
  }

  extractKeyQuote(zettel: Record<string, unknown>): string {
    const content = (zettel.content as string) ?? '';
    const origin = (zettel.origin_label as string) ?? '';
    const notes = (zettel.notes as string) ?? '';
    const title = (zettel.title as string) ?? '';
    const allText = `${content} ${origin} ${notes}`;

    const quotes: string[] = [];

    // Direct quotes
    for (const m of allText.matchAll(/"([^"]{8,55})"/g)) {
      quotes.push(m[1]!);
    }
    // Single quotes (non-apostrophe)
    for (const m of allText.matchAll(/(?:^|[\s(])'([^']{8,55})'(?:[\s.,;:!?)]|$)/g)) {
      quotes.push(m[1]!);
    }
    // Speech verbs
    for (const m of allText.matchAll(
      /(?:says?|said|articulates?|reveals?|admits?|confesses?|asks?):\s*["']?([^.!?]{10,55})[.!?]/gi,
    )) {
      quotes.push(m[1]!);
    }

    if (quotes.length > 0) {
      const unique = [...new Set(quotes.map((q) => q.trim()).filter((q) => q.length >= 8))];

      const emotionalWords = new Set([
        'love',
        'fear',
        'remember',
        'soul',
        'feel',
        'stupid',
        'scared',
        'beautiful',
        'destroy',
        'respect',
        'trust',
        'consciousness',
        'alive',
        'forget',
        'waiting',
        'peace',
        'matter',
        'real',
        'guilt',
        'escape',
        'rest',
        'hope',
        'dream',
        'lost',
        'found',
      ]);

      const scored = unique.map((q) => {
        let score = 0;
        if (q[0]!.toUpperCase() === q[0] || q.startsWith('I ')) score += 2;
        const qLower = q.toLowerCase();
        for (const w of emotionalWords) {
          if (qLower.includes(w)) score += 2;
        }
        if (q.length > 20) score += 1;
        if (q.startsWith('The ') || q.startsWith('This ') || q.startsWith('She ')) score -= 2;
        return { score, text: q };
      });

      scored.sort((a, b) => b.score - a.score);
      if (scored.length > 0) return scored[0]!.text;
    }

    if (title.includes(' - ')) return title.split(' - ', 2)[1]!.slice(0, 45);
    return '';
  }

  encodeZettel(zettel: Record<string, unknown>): string {
    const zid = ((zettel.id as string) ?? '').split('-').pop() ?? '';
    const people = (zettel.people as string[]) ?? [];

    let entityCodes = people
      .map((p) => this.encodeEntity(p))
      .filter((e): e is string => e !== null);
    if (entityCodes.length === 0) entityCodes = ['???'];
    const entities = [...new Set(entityCodes)].sort().join('+');

    const topics = (zettel.topics as string[]) ?? [];
    const topicStr = topics.length > 0 ? topics.slice(0, 2).join('_') : 'misc';

    const quote = this.extractKeyQuote(zettel);
    const quotePart = quote ? `"${quote}"` : '';

    const weight = (zettel.emotional_weight as number) ?? 0.5;
    const emotions = this.encodeEmotions((zettel.emotional_tone as string[]) ?? []);
    const flags = this.getFlags(zettel);

    const parts = [`${zid}:${entities}`, topicStr];
    if (quotePart) parts.push(quotePart);
    parts.push(String(weight));
    if (emotions) parts.push(emotions);
    if (flags) parts.push(flags);

    return parts.join('|');
  }

  encodeTunnel(tunnel: Record<string, unknown>): string {
    const fromId = ((tunnel.from as string) ?? '').split('-').pop() ?? '';
    const toId = ((tunnel.to as string) ?? '').split('-').pop() ?? '';
    const label = (tunnel.label as string) ?? '';
    const shortLabel = label.includes(':') ? label.split(':')[0]! : label.slice(0, 30);
    return `T:${fromId}<->${toId}|${shortLabel}`;
  }

  encodeFile(zettelJson: Record<string, unknown>): string {
    const lines: string[] = [];
    const source = (zettelJson.source_file as string) ?? 'unknown';
    const fileNum = source.includes('-') ? source.split('-')[0]! : '000';
    const zettels = (zettelJson.zettels as Record<string, unknown>[]) ?? [];
    const date = (zettels[0]?.date_context as string) ?? 'unknown';

    const allPeople = new Set<string>();
    for (const z of zettels) {
      for (const p of (z.people as string[]) ?? []) {
        const code = this.encodeEntity(p);
        if (code) allPeople.add(code);
      }
    }
    if (allPeople.size === 0) allPeople.add('???');
    const primary = [...allPeople].sort().slice(0, 3).join('+');

    const titlePart = source.includes('-')
      ? source.replace('.txt', '').split('-').slice(1).join('-').trim()
      : source;
    lines.push(`${fileNum}|${primary}|${date}|${titlePart}`);

    const arc = (zettelJson.emotional_arc as string) ?? '';
    if (arc) lines.push(`ARC:${arc}`);

    for (const z of zettels) lines.push(this.encodeZettel(z));
    for (const t of (zettelJson.tunnels as Record<string, unknown>[]) ?? []) {
      lines.push(this.encodeTunnel(t));
    }

    return lines.join('\n');
  }

  // ── Decoding ─────────────────────────────────────────────────────────────

  decode(dialectText: string): DecodedDialect {
    const lines = dialectText.trim().split('\n');
    const result: DecodedDialect = { header: {}, arc: '', zettels: [], tunnels: [] };

    for (const line of lines) {
      if (line.startsWith('ARC:')) {
        result.arc = line.slice(4);
      } else if (line.startsWith('T:')) {
        result.tunnels.push(line);
      } else if (line.includes('|') && line.split('|')[0]!.includes(':')) {
        result.zettels.push(line);
      } else if (line.includes('|')) {
        const parts = line.split('|');
        result.header = {
          file: parts[0] ?? '',
          entities: parts[1] ?? '',
          date: parts[2] ?? '',
          title: parts[3] ?? '',
        };
      }
    }

    return result;
  }

  // ── Stats ────────────────────────────────────────────────────────────────

  static countTokens(text: string): number {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    return Math.max(1, Math.round(words.length * 1.3));
  }

  compressionStats(originalText: string, compressed: string): CompressionStats {
    const origTokens = Dialect.countTokens(originalText);
    const compTokens = Dialect.countTokens(compressed);
    return {
      original_tokens_est: origTokens,
      summary_tokens_est: compTokens,
      size_ratio: Math.round((origTokens / Math.max(compTokens, 1)) * 10) / 10,
      original_chars: originalText.length,
      summary_chars: compressed.length,
      note: 'Estimates only. Use tiktoken for accurate counts. AAAK is lossy.',
    };
  }
}
