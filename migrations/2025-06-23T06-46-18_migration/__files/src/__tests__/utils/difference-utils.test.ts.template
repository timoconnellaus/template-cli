import { describe, it, expect } from 'vitest';
import { calculateDifferences } from '../../utils/difference-utils.js';

describe('difference-utils', () => {
  describe('calculateDifferences', () => {
    it('should detect new files', async () => {
      const reconstructedState = {};
      const actualState = {
        'new-file.txt': 'Hello World',
        'config.json': '{"setting": "value"}'
      };
      
      const { migration } = await calculateDifferences(reconstructedState, actualState);
      
      expect(migration['new-file.txt']).toEqual({
        type: 'new',
        path: 'new-file.txt'
      });
      expect(migration['config.json']).toEqual({
        type: 'new',
        path: 'config.json'
      });
    });

    it('should detect deleted files', async () => {
      // Mock the confirm prompt to always return false (not a move)
      const { vi } = await import('vitest');
      const confirmMock = vi.fn().mockResolvedValue(false);
      
      // Mock the inquirer module
      vi.doMock('@inquirer/prompts', () => ({
        confirm: confirmMock,
        select: vi.fn()
      }));
      
      // Re-import the function with mocked inquirer
      const { calculateDifferences: mockedCalculateDifferences } = await import('../../utils/difference-utils.js');
      
      const reconstructedState = {
        'old-file.txt': 'content',
        'another-file.txt': 'more content'
      };
      const actualState = {};
      
      const { migration } = await mockedCalculateDifferences(reconstructedState, actualState);
      
      expect(migration['old-file.txt']).toEqual({
        type: 'delete',
        path: 'old-file.txt'
      });
      expect(migration['another-file.txt']).toEqual({
        type: 'delete',
        path: 'another-file.txt'
      });
      
      vi.doUnmock('@inquirer/prompts');
    });

    it('should detect modified files', async () => {
      const reconstructedState = {
        'test.txt': 'original content',
        'unchanged.txt': 'same content'
      };
      const actualState = {
        'test.txt': 'modified content',
        'unchanged.txt': 'same content'
      };
      
      const { migration, diffContents } = await calculateDifferences(reconstructedState, actualState);
      
      expect(migration['test.txt']).toEqual({
        type: 'modify',
        diffFile: expect.stringMatching(/\.diff$/)
      });
      expect(migration['unchanged.txt']).toBeUndefined();
      
      // Check that diff file is created
      const diffFile = migration['test.txt'].diffFile!;
      expect(diffContents[diffFile]).toContain('@@'); // Unified diff format
      expect(diffContents[diffFile]).toContain('-original content');
      expect(diffContents[diffFile]).toContain('+modified content');
    });

    it('should detect mixed changes', async () => {
      const reconstructedState = {
        'keep-unchanged.txt': 'unchanged',
        'modify-this.txt': 'old content'
      };
      const actualState = {
        'keep-unchanged.txt': 'unchanged',
        'modify-this.txt': 'new content',
        'new-file.txt': 'brand new'
      };
      
      const { migration } = await calculateDifferences(reconstructedState, actualState);
      
      // Should not include unchanged file
      expect(migration['keep-unchanged.txt']).toBeUndefined();
      
      // Should detect modification
      expect(migration['modify-this.txt']).toBeDefined();
      expect(migration['modify-this.txt'].type).toBe('modify');
      
      // Should detect new file
      expect(migration['new-file.txt']).toEqual({
        type: 'new',
        path: 'new-file.txt'
      });
    });

    it('should handle empty states', async () => {
      // Both states empty
      let { migration } = await calculateDifferences({}, {});
      expect(migration).toEqual({});
      
      // Only reconstructed state empty
      ({ migration } = await calculateDifferences({}, { 'file.txt': 'content' }));
      expect(migration['file.txt']).toEqual({
        type: 'new',
        path: 'file.txt'
      });
      
      // Only actual state empty
      ({ migration } = await calculateDifferences({ 'file.txt': 'content' }, {}));
      expect(migration['file.txt']).toEqual({
        type: 'delete',
        path: 'file.txt'
      });
    });

    it('should handle multiline file modifications', async () => {
      const reconstructedState = {
        'multiline.txt': 'line 1\nline 2\nline 3'
      };
      const actualState = {
        'multiline.txt': 'line 1\nmodified line 2\nline 3\nnew line 4'
      };
      
      const { migration, diffContents } = await calculateDifferences(reconstructedState, actualState);
      
      expect(migration['multiline.txt']).toEqual({
        type: 'modify',
        diffFile: expect.stringMatching(/\.diff$/)
      });
      
      const diffFile = migration['multiline.txt'].diffFile!;
      const diffContent = diffContents[diffFile];
      expect(diffContent).toContain('@@'); // Unified diff format
      
      // Should detect changes to line 2 and addition of line 4
      expect(diffContent).toContain('-line 2');
      expect(diffContent).toContain('+modified line 2');
      expect(diffContent).toContain('+new line 4');
    });

    it('should handle files with only whitespace differences', async () => {
      const reconstructedState = {
        'whitespace.txt': 'content'
      };
      const actualState = {
        'whitespace.txt': 'content\n'
      };
      
      const { migration, diffContents } = await calculateDifferences(reconstructedState, actualState);
      
      expect(migration['whitespace.txt']).toEqual({
        type: 'modify',
        diffFile: expect.stringMatching(/\.diff$/)
      });
      
      const diffFile = migration['whitespace.txt'].diffFile!;
      const diffContent = diffContents[diffFile];
      expect(diffContent).toContain('@@'); // Unified diff format
    });
  });
});