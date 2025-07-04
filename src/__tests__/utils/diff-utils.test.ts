import { describe, it, expect } from 'vitest';
import { generateUnifiedDiff, applyUnifiedDiff } from '../../utils/diff-utils.js';

describe('diff-utils', () => {

  describe('generateUnifiedDiff', () => {
    it('should generate unified diff for simple changes', () => {
      const oldContent = 'line 1\nline 2\nline 3';
      const newContent = 'line 1\nmodified line 2\nline 3';
      
      const diff = generateUnifiedDiff(oldContent, newContent, 'old.txt', 'new.txt');
      
      expect(diff).toContain('--- old.txt');
      expect(diff).toContain('+++ new.txt');
      expect(diff).toContain('@@');
      expect(diff).toContain('-line 2');
      expect(diff).toContain('+modified line 2');
    });

    it('should generate unified diff for additions', () => {
      const oldContent = 'line 1\nline 3';
      const newContent = 'line 1\nline 2\nline 3';
      
      const diff = generateUnifiedDiff(oldContent, newContent, 'old.txt', 'new.txt');
      
      expect(diff).toContain('@@');
      expect(diff).toContain('+line 2');
    });

    it('should generate unified diff for deletions', () => {
      const oldContent = 'line 1\nline 2\nline 3';
      const newContent = 'line 1\nline 3';
      
      const diff = generateUnifiedDiff(oldContent, newContent, 'old.txt', 'new.txt');
      
      expect(diff).toContain('@@');
      expect(diff).toContain('-line 2');
    });

    it('should handle empty files', () => {
      const diff = generateUnifiedDiff('', 'new content', 'old.txt', 'new.txt');
      
      expect(diff).toContain('--- old.txt');
      expect(diff).toContain('+++ new.txt');
      expect(diff).toContain('+new content');
    });
  });

  describe('applyUnifiedDiff', () => {
    it('should apply unified diff correctly', () => {
      const originalContent = 'line 1\nline 2\nline 3';
      const diffContent = `--- old.txt
+++ new.txt
@@ -1,3 +1,3 @@
 line 1
-line 2
+modified line 2
 line 3`;
      
      const result = applyUnifiedDiff(originalContent, diffContent);
      
      expect(result).toBe('line 1\nmodified line 2\nline 3');
    });

    it('should apply addition diffs correctly', () => {
      const originalContent = 'line 1\nline 3';
      const diffContent = `--- old.txt
+++ new.txt
@@ -1,2 +1,3 @@
 line 1
+line 2
 line 3`;
      
      const result = applyUnifiedDiff(originalContent, diffContent);
      
      expect(result).toBe('line 1\nline 2\nline 3');
    });

    it('should apply deletion diffs correctly', () => {
      const originalContent = 'line 1\nline 2\nline 3';
      const diffContent = `--- old.txt
+++ new.txt
@@ -1,3 +1,2 @@
 line 1
-line 2
 line 3`;
      
      const result = applyUnifiedDiff(originalContent, diffContent);
      
      expect(result).toBe('line 1\nline 3');
    });
  });
});