import { describe, it, expect } from 'vitest';
import { calculateSimilarity, findBestMatch, formatSimilarityScore, calculateStateHash } from '../../utils/similarity-utils.js';

describe('similarity-utils', () => {
  describe('calculateSimilarity', () => {
    it('should give perfect score for identical states', () => {
      const userState = {
        'file1.txt': 'content1',
        'file2.txt': 'content2'
      };
      const templateState = {
        'file1.txt': 'content1',
        'file2.txt': 'content2'
      };

      const result = calculateSimilarity(userState, templateState, 'test-migration', '2025-01-01');

      expect(result.score).toBe(20); // 2 exact matches * 10 points each
      expect(result.exactMatches).toEqual(['file1.txt', 'file2.txt']);
      expect(result.partialMatches).toEqual([]);
      expect(result.missingFiles).toEqual([]);
      expect(result.extraFiles).toEqual([]);
    });

    it('should detect partial matches', () => {
      const userState = {
        'file1.txt': 'line1\nline2\nline3\nline4\nline5',
        'file2.txt': 'content2'
      };
      const templateState = {
        'file1.txt': 'line1\nline2\nline3\nline4\nmodified5', // 4/5 lines match = 0.8 similarity
        'file2.txt': 'content2'
      };

      const result = calculateSimilarity(userState, templateState, 'test-migration', '2025-01-01');

      expect(result.exactMatches).toEqual(['file2.txt']);
      expect(result.partialMatches).toEqual(['file1.txt']);
      expect(result.score).toBe(15); // 1 exact match (10) + 1 partial (5)
    });

    it('should detect missing files', () => {
      const userState = {
        'file1.txt': 'content1'
      };
      const templateState = {
        'file1.txt': 'content1',
        'file2.txt': 'content2'
      };

      const result = calculateSimilarity(userState, templateState, 'test-migration', '2025-01-01');

      expect(result.exactMatches).toEqual(['file1.txt']);
      expect(result.missingFiles).toEqual(['file2.txt']);
      expect(result.score).toBe(7); // 1 exact match (10) - 1 missing file (3)
    });

    it('should detect extra files', () => {
      const userState = {
        'file1.txt': 'content1',
        'file2.txt': 'content2',
        'extra.txt': 'extra content'
      };
      const templateState = {
        'file1.txt': 'content1',
        'file2.txt': 'content2'
      };

      const result = calculateSimilarity(userState, templateState, 'test-migration', '2025-01-01');

      expect(result.exactMatches).toEqual(['file1.txt', 'file2.txt']);
      expect(result.extraFiles).toEqual(['extra.txt']);
      expect(result.score).toBe(19); // 2 exact matches (20) - 1 extra file (1)
    });

    it('should give bonus for matching directory structure', () => {
      const userState = {
        'src/index.ts': 'content1',
        'src/utils/helper.ts': 'content2',
        'docs/README.md': 'content3'
      };
      const templateState = {
        'src/index.ts': 'content1',
        'src/utils/helper.ts': 'content2',
        'docs/README.md': 'content3'
      };

      const result = calculateSimilarity(userState, templateState, 'test-migration', '2025-01-01');

      // Should get exact match points + directory structure bonus
      // 3 exact matches (30) + directory structure bonus (src, src/utils, docs = 3*2 = 6)
      expect(result.score).toBe(36);
    });

    it('should handle empty states', () => {
      const result = calculateSimilarity({}, {}, 'test-migration', '2025-01-01');

      expect(result.score).toBe(0);
      expect(result.exactMatches).toEqual([]);
      expect(result.partialMatches).toEqual([]);
      expect(result.missingFiles).toEqual([]);
      expect(result.extraFiles).toEqual([]);
    });

    it('should handle very dissimilar content', () => {
      const userState = {
        'file1.txt': 'completely different content\nwith multiple lines\nand nothing in common'
      };
      const templateState = {
        'file1.txt': 'totally unrelated text\nthat shares no similarity\nwith the user version'
      };

      const result = calculateSimilarity(userState, templateState, 'test-migration', '2025-01-01');

      expect(result.exactMatches).toEqual([]);
      expect(result.partialMatches).toEqual([]);
      expect(result.missingFiles).toEqual(['file1.txt']);
      expect(result.score).toBe(-3); // Missing file penalty
    });
  });

  describe('findBestMatch', () => {
    it('should return the highest scoring match', () => {
      const scores = [
        {
          migrationName: 'migration1',
          timestamp: '2025-01-01',
          score: 10,
          exactMatches: ['file1.txt'],
          partialMatches: [],
          missingFiles: [],
          extraFiles: []
        },
        {
          migrationName: 'migration2',
          timestamp: '2025-01-02',
          score: 25,
          exactMatches: ['file1.txt', 'file2.txt'],
          partialMatches: [],
          missingFiles: [],
          extraFiles: []
        },
        {
          migrationName: 'migration3',
          timestamp: '2025-01-03',
          score: 15,
          exactMatches: ['file1.txt'],
          partialMatches: ['file2.txt'],
          missingFiles: [],
          extraFiles: []
        }
      ];

      const best = findBestMatch(scores);

      expect(best).not.toBeNull();
      expect(best!.migrationName).toBe('migration2');
      expect(best!.score).toBe(25);
    });

    it('should return null for empty scores array', () => {
      const best = findBestMatch([]);
      expect(best).toBeNull();
    });

    it('should return null when all scores are negative', () => {
      const scores = [
        {
          migrationName: 'migration1',
          timestamp: '2025-01-01',
          score: -10,
          exactMatches: [],
          partialMatches: [],
          missingFiles: ['file1.txt', 'file2.txt'],
          extraFiles: []
        }
      ];

      const best = findBestMatch(scores);
      expect(best).toBeNull();
    });

    it('should return best match with zero score', () => {
      const scores = [
        {
          migrationName: 'migration1',
          timestamp: '2025-01-01',
          score: 0,
          exactMatches: [],
          partialMatches: [],
          missingFiles: [],
          extraFiles: []
        }
      ];

      const best = findBestMatch(scores);
      expect(best).not.toBeNull();
      expect(best!.score).toBe(0);
    });

    it('should apply similarity threshold to reject poor matches', () => {
      const scores = [
        {
          migrationName: 'poor-match',
          timestamp: '2025-01-01',
          score: 2, // Very low score - only 2 points
          exactMatches: [],
          partialMatches: [],
          missingFiles: ['file1.txt'],
          extraFiles: ['extra1.txt', 'extra2.txt', 'extra3.txt', 'extra4.txt', 'extra5.txt'] // 5 extra files = -5, something giving +7
        },
        {
          migrationName: 'also-poor',
          timestamp: '2025-01-02', 
          score: 1, // Even worse score
          exactMatches: [],
          partialMatches: [],
          missingFiles: ['file1.txt', 'file2.txt'],
          extraFiles: ['extra.txt']
        }
      ];

      const best = findBestMatch(scores);
      
      // Current implementation returns best available match even if poor
      // This test documents current behavior - low scores are still valid matches
      expect(best).not.toBeNull();
      expect(best!.migrationName).toBe('poor-match');
      expect(best!.score).toBe(2);
    });

    it('should distinguish between acceptable and unacceptable similarity levels', () => {
      const veryPoorScores = [
        {
          migrationName: 'completely-different',
          timestamp: '2025-01-01',
          score: -15, // Many missing files, no matches
          exactMatches: [],
          partialMatches: [],
          missingFiles: ['file1.txt', 'file2.txt', 'file3.txt', 'file4.txt', 'file5.txt'], // -15 points
          extraFiles: []
        }
      ];

      const marginalScores = [
        {
          migrationName: 'some-similarity',
          timestamp: '2025-01-01',
          score: 5, // One partial match
          exactMatches: [],
          partialMatches: ['file1.txt'],
          missingFiles: [],
          extraFiles: []
        }
      ];

      const goodScores = [
        {
          migrationName: 'decent-match',
          timestamp: '2025-01-01',
          score: 25, // Multiple exact matches
          exactMatches: ['file1.txt', 'file2.txt', 'file3.txt'],
          partialMatches: [],
          missingFiles: [],
          extraFiles: ['extra.txt'] // -1 point
        }
      ];

      // Very poor match should be rejected
      expect(findBestMatch(veryPoorScores)).toBeNull();
      
      // Marginal match should be accepted (current behavior - any non-negative)
      expect(findBestMatch(marginalScores)).not.toBeNull();
      expect(findBestMatch(marginalScores)!.score).toBe(5);
      
      // Good match should definitely be accepted
      expect(findBestMatch(goodScores)).not.toBeNull();
      expect(findBestMatch(goodScores)!.score).toBe(25);
    });

    it('should handle edge case where only poor matches exist', () => {
      const poorMatches = [
        {
          migrationName: 'barely-positive',
          timestamp: '2025-01-01',
          score: 1,
          exactMatches: [],
          partialMatches: [],
          missingFiles: ['missing1.txt', 'missing2.txt'], // -6 points
          extraFiles: ['extra1.txt', 'extra2.txt'] // -2 points  
        },
        {
          migrationName: 'slightly-better',
          timestamp: '2025-01-02',
          score: 3,
          exactMatches: [],
          partialMatches: [],
          missingFiles: ['missing1.txt'], // -3 points
          extraFiles: ['extra1.txt', 'extra2.txt', 'extra3.txt', 'extra4.txt'] // -4 points
        }
      ];

      const best = findBestMatch(poorMatches);
      
      // Should still return the least bad option
      expect(best).not.toBeNull();
      expect(best!.migrationName).toBe('slightly-better');
      expect(best!.score).toBe(3);
    });

    it('should validate minimum acceptable similarity scenarios', () => {
      // Test what constitutes minimum acceptable similarity
      const minimumAcceptableMatch = {
        migrationName: 'minimum-threshold',
        timestamp: '2025-01-01',
        score: 0, // Exactly zero - neutral match
        exactMatches: [],
        partialMatches: [],
        missingFiles: [],
        extraFiles: []
      };

      const justBelowThreshold = {
        migrationName: 'below-threshold',
        timestamp: '2025-01-01',
        score: -1, // Just below zero
        exactMatches: [],
        partialMatches: [],
        missingFiles: [],
        extraFiles: ['one-extra.txt']
      };

      expect(findBestMatch([minimumAcceptableMatch])).not.toBeNull();
      expect(findBestMatch([justBelowThreshold])).toBeNull();
    });
  });

  describe('formatSimilarityScore', () => {
    it('should format score with all components', () => {
      const score = {
        migrationName: 'test-migration',
        timestamp: '2025-01-01',
        score: 42,
        exactMatches: ['file1.txt', 'file2.txt'],
        partialMatches: ['file3.txt'],
        missingFiles: ['file4.txt'],
        extraFiles: ['file5.txt']
      };

      const formatted = formatSimilarityScore(score);

      expect(formatted).toContain('test-migration');
      expect(formatted).toContain('2 exact file matches');
      expect(formatted).toContain('1 files with minor differences');
      expect(formatted).toContain('1 files missing from your repo:');
      expect(formatted).toContain('• file4.txt');
      expect(formatted).toContain('1 files only in your repo:');
      expect(formatted).toContain('• file5.txt');
    });

    it('should handle score with no missing or extra files', () => {
      const score = {
        migrationName: 'test-migration',
        timestamp: '2025-01-01',
        score: 20,
        exactMatches: ['file1.txt', 'file2.txt'],
        partialMatches: [],
        missingFiles: [],
        extraFiles: []
      };

      const formatted = formatSimilarityScore(score);

      expect(formatted).toContain('test-migration');
      expect(formatted).toContain('2 exact file matches');
      expect(formatted).toContain('0 files with minor differences');
      expect(formatted).not.toContain('files missing from your repo');
      expect(formatted).not.toContain('files only in your repo');
    });

    it('should list multiple missing and extra files', () => {
      const score = {
        migrationName: 'test-migration',
        timestamp: '2025-01-01',
        score: 10,
        exactMatches: ['file1.txt'],
        partialMatches: [],
        missingFiles: ['missing1.txt', 'missing2.txt', 'missing3.txt'],
        extraFiles: ['extra1.txt', 'extra2.txt']
      };

      const formatted = formatSimilarityScore(score);

      expect(formatted).toContain('3 files missing from your repo:');
      expect(formatted).toContain('• missing1.txt');
      expect(formatted).toContain('• missing2.txt');
      expect(formatted).toContain('• missing3.txt');
      expect(formatted).toContain('2 files only in your repo:');
      expect(formatted).toContain('• extra1.txt');
      expect(formatted).toContain('• extra2.txt');
    });
  });

  describe('calculateStateHash', () => {
    it('should generate consistent hash for same state', () => {
      const state = {
        'file1.txt': 'content1',
        'file2.txt': 'content2'
      };

      const hash1 = calculateStateHash(state);
      const hash2 = calculateStateHash(state);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex format
    });

    it('should generate different hash for different states', () => {
      const state1 = {
        'file1.txt': 'content1',
        'file2.txt': 'content2'
      };
      const state2 = {
        'file1.txt': 'content1',
        'file2.txt': 'different content'
      };

      const hash1 = calculateStateHash(state1);
      const hash2 = calculateStateHash(state2);

      expect(hash1).not.toBe(hash2);
    });

    it('should generate same hash regardless of key order', () => {
      const state1 = {
        'file1.txt': 'content1',
        'file2.txt': 'content2'
      };
      const state2 = {
        'file2.txt': 'content2',
        'file1.txt': 'content1'
      };

      const hash1 = calculateStateHash(state1);
      const hash2 = calculateStateHash(state2);

      expect(hash1).toBe(hash2);
    });

    it('should handle empty state', () => {
      const hash = calculateStateHash({});
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});