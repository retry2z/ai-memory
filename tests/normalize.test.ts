import { describe, expect, it } from 'bun:test';
import { normalizeText } from '../src/normalize.js';

describe('Normalize', () => {
  it('should pass through text with > markers unchanged', () => {
    const content =
      '> What is this?\nA reply\n\n> Another question?\nAnother reply\n\n> Third one\nThird reply';
    const result = normalizeText(content);
    expect(result).toBe(content);
  });

  it('should normalize Claude Code JSONL', () => {
    const jsonl = [
      '{"type":"human","message":{"content":"Hello"}}',
      '{"type":"assistant","message":{"content":"Hi there"}}',
      '{"type":"human","message":{"content":"How are you?"}}',
      '{"type":"assistant","message":{"content":"I am well"}}',
    ].join('\n');

    const result = normalizeText(jsonl);
    expect(result).toContain('> Hello');
    expect(result).toContain('Hi there');
    expect(result).toContain('> How are you?');
  });

  it('should normalize Claude AI JSON export', () => {
    const json = JSON.stringify([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Second question' },
      { role: 'assistant', content: 'Second answer' },
    ]);

    const result = normalizeText(json);
    expect(result).toContain('> First question');
    expect(result).toContain('First answer');
  });

  it('should normalize Slack JSON export', () => {
    const json = JSON.stringify([
      { type: 'message', user: 'U001', text: 'Hey team' },
      { type: 'message', user: 'U002', text: 'Hi!' },
      { type: 'message', user: 'U001', text: 'What are we working on?' },
      { type: 'message', user: 'U002', text: 'The new feature' },
    ]);

    const result = normalizeText(json);
    expect(result).toContain('>');
  });

  it('should return plain text unchanged if no format detected', () => {
    const text = 'Just some plain text with no special formatting.';
    const result = normalizeText(text);
    expect(result).toBe(text);
  });

  it('should handle empty content', () => {
    expect(normalizeText('')).toBe('');
    expect(normalizeText('   ')).toBe('   ');
  });
});
