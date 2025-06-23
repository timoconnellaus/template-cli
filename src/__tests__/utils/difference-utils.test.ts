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
      
      const differences = await calculateDifferences(reconstructedState, actualState);
      
      expect(differences['new-file.txt']).toEqual({
        type: 'new',
        path: 'new-file.txt'
      });
      expect(differences['config.json']).toEqual({
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
      
      const differences = await mockedCalculateDifferences(reconstructedState, actualState);
      
      expect(differences['old-file.txt']).toEqual({
        type: 'delete',
        path: 'old-file.txt'
      });
      expect(differences['another-file.txt']).toEqual({
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
      
      const differences = await calculateDifferences(reconstructedState, actualState);
      
      expect(differences['test.txt']).toEqual({
        type: 'modify',
        diffs: expect.any(Array)
      });
      expect(differences['unchanged.txt']).toBeUndefined();
      
      // Check that diffs are calculated
      const diffs = differences['test.txt'].diffs!;
      expect(diffs.length).toBeGreaterThan(0);
      expect(diffs[0].operation).toBe('replace');
      expect(diffs[0].oldContent).toBe('original content');
      expect(diffs[0].newContent).toBe('modified content');
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
      
      const differences = await calculateDifferences(reconstructedState, actualState);
      
      // Should not include unchanged file
      expect(differences['keep-unchanged.txt']).toBeUndefined();
      
      // Should detect modification
      expect(differences['modify-this.txt']).toBeDefined();
      expect(differences['modify-this.txt'].type).toBe('modify');
      
      // Should detect new file
      expect(differences['new-file.txt']).toEqual({
        type: 'new',
        path: 'new-file.txt'
      });
    });

    it('should handle empty states', async () => {
      // Both states empty
      let differences = await calculateDifferences({}, {});
      expect(differences).toEqual({});
      
      // Only reconstructed state empty
      differences = await calculateDifferences({}, { 'file.txt': 'content' });
      expect(differences['file.txt']).toEqual({
        type: 'new',
        path: 'file.txt'
      });
      
      // Only actual state empty
      differences = await calculateDifferences({ 'file.txt': 'content' }, {});
      expect(differences['file.txt']).toEqual({
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
      
      const differences = await calculateDifferences(reconstructedState, actualState);
      
      expect(differences['multiline.txt']).toEqual({
        type: 'modify',
        diffs: expect.any(Array)
      });
      
      const diffs = differences['multiline.txt'].diffs!;
      expect(diffs.length).toBeGreaterThan(0);
      
      // Should detect changes to line 2 and addition of line 4
      const replaceOps = diffs.filter(d => d.operation === 'replace');
      const insertOps = diffs.filter(d => d.operation === 'insert');
      
      expect(replaceOps.length + insertOps.length).toBeGreaterThan(0);
    });

    it('should handle files with only whitespace differences', async () => {
      const reconstructedState = {
        'whitespace.txt': 'content'
      };
      const actualState = {
        'whitespace.txt': 'content\n'
      };
      
      const differences = await calculateDifferences(reconstructedState, actualState);
      
      expect(differences['whitespace.txt']).toEqual({
        type: 'modify',
        diffs: expect.any(Array)
      });
      
      const diffs = differences['whitespace.txt'].diffs!;
      expect(diffs.length).toBeGreaterThan(0);
    });
  });
});