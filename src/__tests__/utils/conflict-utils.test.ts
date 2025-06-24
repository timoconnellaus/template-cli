import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateUserDiff } from '../../utils/conflict-utils.js';
import * as stateUtils from '../../utils/state-utils.js';

// Mock state-utils
vi.mock('../../utils/state-utils.js', () => ({
  reconstructStateFromMigrations: vi.fn(),
}));

describe('conflict-utils', () => {

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