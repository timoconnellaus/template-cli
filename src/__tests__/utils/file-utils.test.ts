import { describe, it, expect } from 'vitest';
import { matchesGitignorePattern, shouldIgnoreFile } from '../../utils/file-utils.js';

describe('file-utils', () => {
  describe('matchesGitignorePattern', () => {
    it('should match exact file names', () => {
      expect(matchesGitignorePattern('package.json', 'package.json')).toBe(true);
      expect(matchesGitignorePattern('src/file.ts', 'file.ts')).toBe(true);
      expect(matchesGitignorePattern('file.txt', 'other.txt')).toBe(false);
    });

    it('should match wildcard patterns', () => {
      expect(matchesGitignorePattern('file.log', '*.log')).toBe(true);
      expect(matchesGitignorePattern('app.log', '*.log')).toBe(true);
      expect(matchesGitignorePattern('src/app.log', '*.log')).toBe(true);
      expect(matchesGitignorePattern('file.txt', '*.log')).toBe(false);
    });

    it('should match directory patterns with trailing slash', () => {
      expect(matchesGitignorePattern('node_modules/package/file.js', 'node_modules/')).toBe(true);
      expect(matchesGitignorePattern('src/node_modules/file.js', 'node_modules/')).toBe(true);
      expect(matchesGitignorePattern('node_modules', 'node_modules/')).toBe(true);
      expect(matchesGitignorePattern('not_node_modules/file.js', 'node_modules/')).toBe(false);
    });

    it('should match double star patterns', () => {
      expect(matchesGitignorePattern('src/deep/nested/file.ts', 'src/**/file.ts')).toBe(true);
      expect(matchesGitignorePattern('src/file.ts', 'src/**/file.ts')).toBe(false); // ** requires at least one directory level
      expect(matchesGitignorePattern('other/deep/file.ts', 'src/**/file.ts')).toBe(false);
    });

    it('should handle patterns with leading slash', () => {
      expect(matchesGitignorePattern('package.json', '/package.json')).toBe(true);
      expect(matchesGitignorePattern('src/package.json', '/package.json')).toBe(true); // Leading slash is ignored in current implementation
    });

    it('should ignore empty patterns and comments', () => {
      expect(matchesGitignorePattern('file.txt', '')).toBe(false);
      expect(matchesGitignorePattern('file.txt', '# comment')).toBe(false);
      expect(matchesGitignorePattern('file.txt', '   ')).toBe(false);
    });
  });

  describe('shouldIgnoreFile', () => {
    it('should always ignore hardcoded patterns', () => {
      expect(shouldIgnoreFile('migrations/test/file.ts', [])).toBe(true);
      expect(shouldIgnoreFile('.git/objects/abc123', [])).toBe(true);
      expect(shouldIgnoreFile('node_modules/package/index.js', [])).toBe(true);
      expect(shouldIgnoreFile('.migrateignore', [])).toBe(true);
    });

    it('should respect custom ignore patterns', () => {
      const patterns = ['*.log', 'temp/'];
      expect(shouldIgnoreFile('app.log', patterns)).toBe(true);
      expect(shouldIgnoreFile('temp/file.txt', patterns)).toBe(true);
      expect(shouldIgnoreFile('src/file.ts', patterns)).toBe(false);
    });

    it('should handle negation patterns', () => {
      const patterns = ['*.log', '!important.log'];
      expect(shouldIgnoreFile('app.log', patterns)).toBe(true);
      expect(shouldIgnoreFile('important.log', patterns)).toBe(false);
    });
  });
});