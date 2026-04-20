import { describe, expect, it } from 'bun:test';
import {
  classifyEntity,
  detectEntitiesFromTexts,
  extractCandidates,
  scoreEntity,
} from '../src/entity-detector.js';

describe('Entity Detector', () => {
  describe('extractCandidates', () => {
    it('should extract capitalized words appearing 3+ times', () => {
      const text = 'Alice went to the store. Alice bought milk. Alice came home.';
      const candidates = extractCandidates(text);
      expect(candidates.get('Alice')).toBe(3);
    });

    it('should filter out stopwords', () => {
      const text = 'The The The world world world';
      const candidates = extractCandidates(text);
      expect(candidates.has('The')).toBe(false);
    });

    it('should ignore words appearing fewer than 3 times', () => {
      const text = 'Alice went to see Bob';
      const candidates = extractCandidates(text);
      expect(candidates.size).toBe(0);
    });
  });

  describe('scoreEntity', () => {
    it('should score person signals for dialogue patterns', () => {
      const text = 'Alice said hello. Alice asked a question. Alice told us.';
      const lines = text.split('\n');
      const scores = scoreEntity('Alice', text, lines);
      expect(scores.person_score).toBeGreaterThan(0);
      expect(scores.person_signals.length).toBeGreaterThan(0);
    });

    it('should score project signals for build patterns', () => {
      const text = 'building MemPal. deployed MemPal. MemPal v2 is ready.';
      const lines = text.split('\n');
      const scores = scoreEntity('MemPal', text, lines);
      expect(scores.project_score).toBeGreaterThan(0);
    });
  });

  describe('classifyEntity', () => {
    it('should classify as uncertain with no signals', () => {
      const entity = classifyEntity('Unknown', 5, {
        person_score: 0,
        project_score: 0,
        person_signals: [],
        project_signals: [],
      });
      expect(entity.type).toBe('uncertain');
    });

    it('should classify as project with strong project signals', () => {
      const entity = classifyEntity('MemPal', 10, {
        person_score: 0,
        project_score: 15,
        person_signals: [],
        project_signals: ['project verb (5x)', 'versioned/hyphenated (2x)'],
      });
      expect(entity.type).toBe('project');
    });
  });

  describe('detectEntitiesFromTexts', () => {
    it('should detect entities from multiple texts', () => {
      const texts = [
        'Alice said she was going to the store. Alice asked Bob to come along. Alice told Bob about her plans.',
        'Bob replied to Alice. Bob said he would go. Bob asked when.',
      ];
      const result = detectEntitiesFromTexts(texts);
      expect(
        result.people.length + result.projects.length + result.uncertain.length,
      ).toBeGreaterThan(0);
    });

    it('should return empty result for empty input', () => {
      const result = detectEntitiesFromTexts([]);
      expect(result.people).toHaveLength(0);
      expect(result.projects).toHaveLength(0);
      expect(result.uncertain).toHaveLength(0);
    });
  });
});
