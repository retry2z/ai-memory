import { describe, expect, it } from 'bun:test';
import { Dialect } from '../src/dialect.js';

describe('Dialect (AAAK Compression)', () => {
  it('should compress plain text into AAAK format', () => {
    const dialect = new Dialect();
    const text = 'We decided to use GraphQL instead of REST because it reduces over-fetching.';
    const result = dialect.compress(text);
    expect(result).toContain('|');
    // AAAK is lossy summarization — output is shorter in tokens, not necessarily chars for short inputs
    expect(Dialect.countTokens(result)).toBeLessThan(Dialect.countTokens(text));
  });

  it('should detect emotions from text', () => {
    const dialect = new Dialect();
    const text = 'I was really excited about the breakthrough but also worried about the deadline.';
    const result = dialect.compress(text);
    // Should contain emotion codes
    expect(result).toMatch(/excite|anx/);
  });

  it('should detect flags from text', () => {
    const dialect = new Dialect();
    const text = 'We decided to migrate the database architecture to a new framework.';
    const result = dialect.compress(text);
    expect(result).toMatch(/DECISION|TECHNICAL/);
  });

  it('should include metadata header when provided', () => {
    const dialect = new Dialect();
    const text = 'Some memory content here';
    const result = dialect.compress(text, {
      wing: 'wing_project',
      room: 'decisions',
      date: '2026-01-15',
    });
    expect(result).toContain('wing_project');
    expect(result).toContain('decisions');
  });

  it('should use custom entity codes', () => {
    const dialect = new Dialect({ Alice: 'ALC', Bob: 'BOB' });
    const text = 'Alice and Bob discussed the project architecture.';
    const result = dialect.compress(text);
    expect(result).toMatch(/ALC|BOB/);
  });

  it('should encode emotions list to compact codes', () => {
    const dialect = new Dialect();
    const result = dialect.encodeEmotions(['joy', 'trust', 'fear']);
    expect(result).toBe('joy+trust+fear');
  });

  it('should limit emotions to 3', () => {
    const dialect = new Dialect();
    const result = dialect.encodeEmotions(['joy', 'trust', 'fear', 'hope', 'love']);
    expect(result.split('+').length).toBe(3);
  });

  it('should decode AAAK text back to structured data', () => {
    const dialect = new Dialect();
    const aaakText =
      '001|ALC+BOB|2026-01-15|test-file\nARC:joy->trust->peace\n01:ALC|topic_one|"key quote"|0.8|joy|ORIGIN\nT:01<->02|link';
    const decoded = dialect.decode(aaakText);
    expect(decoded.header.file).toBe('001');
    expect(decoded.arc).toBe('joy->trust->peace');
    expect(decoded.zettels).toHaveLength(1);
    expect(decoded.tunnels).toHaveLength(1);
  });

  it('should compute compression stats', () => {
    const dialect = new Dialect();
    const original =
      'This is a much longer piece of text that contains many words and ideas about architecture decisions.';
    const compressed = dialect.compress(original);
    const stats = dialect.compressionStats(original, compressed);
    expect(stats.original_tokens_est).toBeGreaterThan(0);
    expect(stats.summary_tokens_est).toBeGreaterThan(0);
    expect(stats.size_ratio).toBeGreaterThan(0);
  });

  it('should count tokens from text', () => {
    const count = Dialect.countTokens('hello world foo bar');
    expect(count).toBeGreaterThanOrEqual(4);
    expect(count).toBeLessThanOrEqual(8);
  });

  it('should encode entity to short code', () => {
    const dialect = new Dialect({ Alice: 'ALC' });
    expect(dialect.encodeEntity('Alice')).toBe('ALC');
    expect(dialect.encodeEntity('UnknownPerson')).toBe('UNK');
  });

  it('should skip names in skip list', () => {
    const dialect = new Dialect({}, ['gandalf']);
    expect(dialect.encodeEntity('Gandalf')).toBeNull();
  });
});
