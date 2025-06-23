import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveConflict } from '../../utils/conflict-utils.js';
import * as readline from 'readline';

// Mock readline
vi.mock('readline', () => ({
  createInterface: vi.fn(),
}));

describe('conflict-utils', () => {
  let mockRl: any;
  let mockQuestion: any;

  beforeEach(() => {
    mockQuestion = vi.fn();
    mockRl = {
      question: mockQuestion,
      close: vi.fn(),
    };
    vi.mocked(readline.createInterface).mockReturnValue(mockRl);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveConflict', () => {
    it('should return keep action when user chooses 1', async () => {
      // Mock user input to choose "1" (keep)
      mockQuestion.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('1');
      });

      const currentContent = 'original content';
      const diffContent = `--- file.txt
+++ file.txt
@@ -1 +1 @@
-original content
+modified content`;
      const error = new Error('Failed to apply diff');

      const result = await resolveConflict('test.txt', currentContent, diffContent, error);

      expect(result.action).toBe('keep');
      expect(result.content).toBe(currentContent);
      expect(mockRl.close).toHaveBeenCalled();
    });

    it('should return template action when user chooses 2', async () => {
      // Mock user input to choose "2" (template)
      mockQuestion.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('2');
      });

      const currentContent = 'original content';
      const diffContent = `--- file.txt
+++ file.txt
@@ -1 +1 @@
-original content
+modified content`;
      const error = new Error('Failed to apply diff');

      const result = await resolveConflict('test.txt', currentContent, diffContent, error);

      expect(result.action).toBe('template');
      expect(result.content).toBe('modified content');
      expect(mockRl.close).toHaveBeenCalled();
    });

    it('should default to keep when user provides invalid choice', async () => {
      // Mock user input to choose invalid option
      mockQuestion.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('invalid');
      });

      const currentContent = 'original content';
      const diffContent = `--- file.txt
+++ file.txt
@@ -1 +1 @@
-original content
+modified content`;
      const error = new Error('Failed to apply diff');

      const result = await resolveConflict('test.txt', currentContent, diffContent, error);

      expect(result.action).toBe('keep');
      expect(result.content).toBe(currentContent);
      expect(mockRl.close).toHaveBeenCalled();
    });

    it('should handle complex diffs when choosing template option', async () => {
      // Mock user input to choose "2" (template)
      mockQuestion.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('2');
      });

      const currentContent = 'line 1\nline 2\nline 3';
      const diffContent = `--- file.txt
+++ file.txt
@@ -1,3 +1,4 @@
 line 1
+new line
 line 2
 line 3`;
      const error = new Error('Failed to apply diff');

      const result = await resolveConflict('test.txt', currentContent, diffContent, error);

      expect(result.action).toBe('template');
      expect(result.content).toBe('line 1\nnew line\nline 2\nline 3');
      expect(mockRl.close).toHaveBeenCalled();
    });
  });
});