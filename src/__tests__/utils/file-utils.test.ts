import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { matchesGitignorePattern, shouldIgnoreFile, isBinaryFile, getCurrentStateWithBinary } from '../../utils/file-utils.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';

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

  describe('isBinaryFile', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'binary-test-'));
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should detect text files as non-binary', async () => {
      const textFile = join(tmpDir, 'text.txt');
      await fs.writeFile(textFile, 'Hello world\nThis is a text file\n', 'utf8');
      expect(await isBinaryFile(textFile)).toBe(false);
    });

    it('should detect null bytes as binary', async () => {
      const binaryFile = join(tmpDir, 'binary.bin');
      const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64]); // "Hello\0World"
      await fs.writeFile(binaryFile, buffer);
      expect(await isBinaryFile(binaryFile)).toBe(true);
    });

    it('should detect high non-printable character percentage as binary', async () => {
      const binaryFile = join(tmpDir, 'binary2.bin');
      const buffer = Buffer.from(Array.from({ length: 100 }, (_, i) => i % 256)); // Lots of non-printable chars
      await fs.writeFile(binaryFile, buffer);
      expect(await isBinaryFile(binaryFile)).toBe(true);
    });

    it('should handle non-existent files gracefully', async () => {
      const nonExistentFile = join(tmpDir, 'does-not-exist.txt');
      expect(await isBinaryFile(nonExistentFile)).toBe(true); // Should assume binary for safety
    });
  });

  describe('getCurrentStateWithBinary', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'state-test-'));
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should separate text and binary files correctly', async () => {
      // Create test files
      const textFile = join(tmpDir, 'text.txt');
      const binaryFile = join(tmpDir, 'binary.bin');
      
      await fs.writeFile(textFile, 'Hello world', 'utf8');
      const binaryBuffer = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00]); // "Hello\0"
      await fs.writeFile(binaryFile, binaryBuffer);

      const state = await getCurrentStateWithBinary(tmpDir, []);

      expect(state.textFiles['text.txt']).toBe('Hello world');
      expect(state.binaryFiles.has('binary.bin')).toBe(true);
      expect(state.binaryFiles.has('text.txt')).toBe(false);
      expect(state.textFiles['binary.bin']).toBeUndefined();
    });

    it('should respect ignore patterns', async () => {
      // Create test files
      await fs.writeFile(join(tmpDir, 'important.txt'), 'Important file', 'utf8');
      await fs.writeFile(join(tmpDir, 'log.txt'), 'Log file', 'utf8');

      const state = await getCurrentStateWithBinary(tmpDir, ['*.log', 'log.txt']);

      expect(state.textFiles['important.txt']).toBe('Important file');
      expect(state.textFiles['log.txt']).toBeUndefined();
    });
  });
});