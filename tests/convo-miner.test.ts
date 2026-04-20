import { describe, expect, it } from 'bun:test';
import { chunkExchanges, detectConvoRoom } from '../src/convo-miner.js';

describe('Conversation Miner', () => {
  describe('chunkExchanges', () => {
    it('should chunk by exchange pairs when > markers present', () => {
      const content = [
        '> What is TypeScript?',
        'TypeScript is a typed superset of JavaScript.',
        '',
        '> How do I install it?',
        'Run npm install -g typescript to install.',
        '',
        '> What about configuration?',
        'Create a tsconfig.json file in your project root.',
      ].join('\n');

      const chunks = chunkExchanges(content);
      expect(chunks.length).toBe(3);
      expect(chunks[0]!.content).toContain('TypeScript');
      expect(chunks[0]!.chunk_index).toBe(0);
    });

    it('should fall back to paragraph chunking without > markers', () => {
      const content = [
        'First paragraph about something interesting.',
        '',
        'Second paragraph about another interesting topic that is longer than the minimum.',
        '',
        'Third paragraph with more content to meet the threshold.',
      ].join('\n');

      const chunks = chunkExchanges(content);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('should skip chunks smaller than minimum size', () => {
      const content = '> Hi\nHi\n\n> Ok\nOk';
      const chunks = chunkExchanges(content);
      expect(chunks.length).toBe(0);
    });

    it('should handle line-group chunking for long content without paragraphs', () => {
      const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of content that goes on`);
      const content = lines.join('\n');
      const chunks = chunkExchanges(content);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('detectConvoRoom', () => {
    it('should detect technical room from code-related content', () => {
      const room = detectConvoRoom(
        'We need to fix the bug in the Python function and debug the API error on the server.',
      );
      expect(room).toBe('technical');
    });

    it('should detect planning room from planning-related content', () => {
      const room = detectConvoRoom(
        'The roadmap for next sprint has a deadline. We need to prioritize the backlog and define the scope.',
      );
      expect(room).toBe('planning');
    });

    it('should detect decisions room from decision-related content', () => {
      const room = detectConvoRoom(
        'We decided to switch the approach and chose the alternative. We migrated and replaced the old system.',
      );
      expect(room).toBe('decisions');
    });

    it('should default to general for unclassifiable content', () => {
      const room = detectConvoRoom('The weather is nice today.');
      expect(room).toBe('general');
    });
  });
});
