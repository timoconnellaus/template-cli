import { describe, it, expect } from 'vitest';
import { calculateLineDiffs } from '../../utils/diff-utils.js';

describe('diff-utils', () => {
  describe('calculateLineDiffs', () => {
    it('should detect line replacements', () => {
      const oldContent = 'line 1\nline 2\nline 3';
      const newContent = 'line 1\nmodified line 2\nline 3';
      
      const diffs = calculateLineDiffs(oldContent, newContent);
      expect(diffs).toHaveLength(1);
      expect(diffs[0]).toEqual({
        operation: 'replace',
        startLine: 2, // 1-based line numbering
        endLine: 2,
        oldContent: 'line 2',
        newContent: 'modified line 2'
      });
    });

    it('should detect line insertions', () => {
      const oldContent = 'line 1\nline 3';
      const newContent = 'line 1\nline 2\nline 3';
      
      const diffs = calculateLineDiffs(oldContent, newContent);
      expect(diffs.length).toBeGreaterThan(0);
      
      // Should have at least one insert operation
      const insertOps = diffs.filter(d => d.operation === 'insert');
      expect(insertOps.length).toBeGreaterThan(0);
    });

    it('should detect line deletions', () => {
      const oldContent = 'line 1\nline 2\nline 3';
      const newContent = 'line 1\nline 3';
      
      const diffs = calculateLineDiffs(oldContent, newContent);
      expect(diffs.length).toBeGreaterThan(0);
      
      // Should have at least one delete operation
      const deleteOps = diffs.filter(d => d.operation === 'delete');
      expect(deleteOps.length).toBeGreaterThan(0);
    });

    it('should handle empty files', () => {
      expect(calculateLineDiffs('', '')).toEqual([]);
      
      const diffs = calculateLineDiffs('', 'new content');
      expect(diffs.length).toBeGreaterThan(0);
      // Should detect some change operation (could be replace or insert depending on implementation)
      expect(['insert', 'replace']).toContain(diffs[0]!.operation);
    });

    it('should handle multiple changes', () => {
      const oldContent = 'line 1\nline 2\nline 3\nline 4';
      const newContent = 'line 1\nmodified line 2\nline 3\nline 5';
      
      const diffs = calculateLineDiffs(oldContent, newContent);
      expect(diffs.length).toBeGreaterThan(0);
      
      // Should detect the replacement of line 2 and line 4
      const replaceOperations = diffs.filter((d: any) => d.operation === 'replace');
      expect(replaceOperations).toHaveLength(2);
    });
  });
});