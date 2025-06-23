import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveConflict, calculateUserDiff } from '../../utils/conflict-utils.js';
import * as readline from 'readline';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as stateUtils from '../../utils/state-utils.js';

// Mock readline
vi.mock('readline', () => ({
  createInterface: vi.fn(),
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

// Mock state-utils
vi.mock('../../utils/state-utils.js', () => ({
  reconstructStateFromMigrations: vi.fn(),
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

    it('should fall back to keep action when Claude CLI fails', async () => {
      // Mock user input to choose "3" (Claude CLI)
      mockQuestion.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('3');
      });

      // Mock spawn to simulate Claude CLI failure
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'error') {
            callback(new Error('Command not found'));
          }
        }),
        stdin: { end: vi.fn() }
      };
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      const currentContent = 'original content';
      const diffContent = `--- file.txt
+++ file.txt
@@ -1 +1 @@
-original content
+modified content`;
      const error = new Error('Failed to apply diff');

      const result = await resolveConflict('test.txt', currentContent, diffContent, error);

      expect(result.action).toBe('claude');
      expect(result.content).toBe(currentContent); // Should fall back to current content
      expect(mockRl.close).toHaveBeenCalled();
    });

    it('should return Claude result when CLI succeeds', async () => {
      // Mock user input to choose "3" (Claude CLI)
      mockQuestion.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('3');
      });

      const claudeResponse = {
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0.003,
        is_error: false,
        duration_ms: 1234,
        duration_api_ms: 800,
        num_turns: 6,
        result: 'merged content from claude',
        session_id: 'abc123'
      };

      // Mock spawn to simulate successful Claude CLI streaming
      const mockChild = {
        stdout: { 
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              // Simulate the streaming format with multiple JSON lines
              const systemMessage = JSON.stringify({
                type: 'system',
                subtype: 'init',
                session_id: 'test-session'
              });
              const assistantMessage = JSON.stringify({
                type: 'assistant',
                message: { content: 'merged content from claude' }
              });
              const streamData = systemMessage + '\n' + assistantMessage + '\n' + JSON.stringify(claudeResponse) + '\n';
              callback(streamData);
            }
          })
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            callback(0); // Success exit code
          }
        }),
        stdin: { end: vi.fn() }
      };
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      // Mock the file system read to return the expected merged content
      vi.mocked(fs.readFileSync).mockReturnValue('merged content from claude');

      const currentContent = 'original content';
      const diffContent = `--- file.txt
+++ file.txt
@@ -1 +1 @@
-original content
+modified content`;
      const error = new Error('Failed to apply diff');

      const result = await resolveConflict('test.txt', currentContent, diffContent, error);

      expect(result.action).toBe('claude');
      expect(result.content).toBe('merged content from claude');
      expect(mockRl.close).toHaveBeenCalled();
    });
  });

  describe('calculateUserDiff', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return null when file content matches baseline', async () => {
      const mockBaselineState = {
        'test.txt': 'original content'
      };
      vi.mocked(stateUtils.reconstructStateFromMigrations).mockResolvedValue(mockBaselineState);

      const result = await calculateUserDiff('test.txt', 'original content', '/template/path');

      expect(result).toBeNull();
      expect(stateUtils.reconstructStateFromMigrations).toHaveBeenCalledWith('/template/path/migrations');
    });

    it('should return user diff when file content differs from baseline', async () => {
      const mockBaselineState = {
        'test.txt': 'original content'
      };
      vi.mocked(stateUtils.reconstructStateFromMigrations).mockResolvedValue(mockBaselineState);

      const result = await calculateUserDiff('test.txt', 'original content\nuser added line', '/template/path');

      expect(result).toContain('--- test.txt.baseline');
      expect(result).toContain('+++ test.txt');
      expect(result).toContain('+user added line');
      expect(stateUtils.reconstructStateFromMigrations).toHaveBeenCalledWith('/template/path/migrations');
    });

    it('should handle new files created by user', async () => {
      const mockBaselineState = {}; // File doesn't exist in baseline
      vi.mocked(stateUtils.reconstructStateFromMigrations).mockResolvedValue(mockBaselineState);

      const result = await calculateUserDiff('new-file.txt', 'user created content', '/template/path');

      expect(result).toContain('--- /dev/null');
      expect(result).toContain('+++ new-file.txt');
      expect(result).toContain('+user created content');
    });

    it('should handle complex user modifications', async () => {
      const mockBaselineState = {
        'complex.txt': 'line 1\nline 2\nline 3\nline 4'
      };
      vi.mocked(stateUtils.reconstructStateFromMigrations).mockResolvedValue(mockBaselineState);

      const userModifiedContent = 'line 1\nuser modified line 2\nline 3\nuser added line\nline 4';
      const result = await calculateUserDiff('complex.txt', userModifiedContent, '/template/path');

      expect(result).toContain('--- complex.txt.baseline');
      expect(result).toContain('+++ complex.txt');
      expect(result).toContain('-line 2');
      expect(result).toContain('+user modified line 2');
      expect(result).toContain('+user added line');
    });

    it('should treat as user-created file and log warning when migration reconstruction fails', async () => {
      vi.mocked(stateUtils.reconstructStateFromMigrations).mockRejectedValue(new Error('Migration error'));
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await calculateUserDiff('test.txt', 'some content', '/template/path');

      // When reconstruction fails, file is treated as user-created
      expect(result).not.toBeNull();
      expect(result).toContain('--- /dev/null');
      expect(result).toContain('+++ test.txt');
      expect(result).toContain('+some content');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not calculate user diff for test.txt:'),
        'Migration error'
      );
      
      consoleSpy.mockRestore();
    });

    it('should use default template path when not provided', async () => {
      const mockBaselineState = {
        'test.txt': 'baseline content'
      };
      vi.mocked(stateUtils.reconstructStateFromMigrations).mockResolvedValue(mockBaselineState);

      await calculateUserDiff('test.txt', 'modified content');

      expect(stateUtils.reconstructStateFromMigrations).toHaveBeenCalledWith('migrations');
    });
  });
});