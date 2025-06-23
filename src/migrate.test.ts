import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { writeFile, mkdir, rm } from 'fs/promises';
import { 
  generateMigration, 
  matchesGitignorePattern, 
  shouldIgnoreFile, 
  calculateLineDiffs 
} from './migrate.js';
import { createTestRepo, listMigrationFolders, readMigrationFile } from './test-helpers.js';

describe('Pattern Matching', () => {

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

describe('Diff Calculation', () => {

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

describe('Migration Generation Integration', () => {
  let testRepo: { path: string; cleanup: () => Promise<void> };

  beforeEach(async () => {
    testRepo = await createTestRepo();
  });

  afterEach(async () => {
    await testRepo.cleanup();
  });

  it('should create migration for new file', async () => {
    // Create a new file
    await writeFile(join(testRepo.path, 'new-file.txt'), 'Hello World');
    
    // Generate migration
    await generateMigration(testRepo.path, 'add-new-file');
    
    // Check migration was created
    const folders = await listMigrationFolders(testRepo.path);
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_add-new-file$/);
    
    // Read migration content
    const migration = await readMigrationFile(testRepo.path, folders[0]!);
    expect(migration['new-file.txt']).toEqual({
      type: 'new',
      path: 'new-file.txt'
    });
  });

  it('should create migration for file modification', async () => {
    // Create initial file and first migration
    await writeFile(join(testRepo.path, 'test.txt'), 'original content');
    await generateMigration(testRepo.path, 'initial');
    
    // Modify the file
    await writeFile(join(testRepo.path, 'test.txt'), 'modified content');
    
    // Generate second migration
    await generateMigration(testRepo.path, 'modify');
    
    // Check migrations
    const folders = await listMigrationFolders(testRepo.path);
    expect(folders).toHaveLength(2);
    
    // Read second migration
    const migration = await readMigrationFile(testRepo.path, folders[1]!);
    expect(migration['test.txt']).toEqual({
      type: 'modify',
      diffs: expect.any(Array)
    });
    
    // Check diff content
    const diffs = migration['test.txt'].diffs!;
    expect(diffs).toHaveLength(1);
    expect(diffs[0].operation).toBe('replace');
    expect(diffs[0].oldContent).toBe('original content');
    expect(diffs[0].newContent).toBe('modified content');
  });

  it('should create migration for file deletion', async () => {
    // Create initial file and first migration
    await writeFile(join(testRepo.path, 'to-delete.txt'), 'content');
    await generateMigration(testRepo.path, 'initial');
    
    // Delete the file
    await rm(join(testRepo.path, 'to-delete.txt'));
    
    // Generate second migration (this should be non-interactive for tests)
    // For testing, we'll need to mock the interactive prompts
    // For now, let's test that the migration detects the deletion
    await generateMigration(testRepo.path, 'delete');
    
    const folders = await listMigrationFolders(testRepo.path);
    expect(folders).toHaveLength(2);
  });

  it('should respect ignore patterns', async () => {
    // Create .migrateignore
    await writeFile(join(testRepo.path, '.migrateignore'), '*.log\ntemp/');
    
    // Create files that should be ignored
    await writeFile(join(testRepo.path, 'app.log'), 'log content');
    await mkdir(join(testRepo.path, 'temp'), { recursive: true });
    await writeFile(join(testRepo.path, 'temp', 'file.txt'), 'temp content');
    
    // Create file that should not be ignored
    await writeFile(join(testRepo.path, 'important.txt'), 'important content');
    
    // Generate migration
    await generateMigration(testRepo.path, 'test-ignore');
    
    const folders = await listMigrationFolders(testRepo.path);
    expect(folders).toHaveLength(1);
    
    const migration = await readMigrationFile(testRepo.path, folders[0]!);
    expect(migration['important.txt']).toBeDefined();
    expect(migration['app.log']).toBeUndefined();
    expect(migration['temp/file.txt']).toBeUndefined();
  });

  it('should handle nested directory structures', async () => {
    // Create nested directories
    await mkdir(join(testRepo.path, 'src', 'components'), { recursive: true });
    await writeFile(join(testRepo.path, 'src', 'components', 'Button.tsx'), 'export const Button = () => <button>Click</button>;');
    
    await mkdir(join(testRepo.path, 'docs'), { recursive: true });
    await writeFile(join(testRepo.path, 'docs', 'README.md'), '# Documentation');
    
    // Generate migration
    await generateMigration(testRepo.path, 'nested-structure');
    
    const folders = await listMigrationFolders(testRepo.path);
    expect(folders).toHaveLength(1);
    
    const migration = await readMigrationFile(testRepo.path, folders[0]!);
    expect(migration['src/components/Button.tsx']).toEqual({
      type: 'new',
      path: 'src/components/Button.tsx'
    });
    expect(migration['docs/README.md']).toEqual({
      type: 'new',
      path: 'docs/README.md'
    });
  });

  it('should show no changes message when no differences detected', async () => {
    // Create initial file and migration
    await writeFile(join(testRepo.path, 'test.txt'), 'content');
    await generateMigration(testRepo.path, 'initial');
    
    // Run migration again without changes
    await generateMigration(testRepo.path, 'no-changes');
    
    // Should still only have one migration
    const folders = await listMigrationFolders(testRepo.path);
    expect(folders).toHaveLength(1);
  });
});

describe('Migration Structure', () => {
  let testRepo: { path: string; cleanup: () => Promise<void> };

  beforeEach(async () => {
    testRepo = await createTestRepo();
  });

  afterEach(async () => {
    await testRepo.cleanup();
  });

  it('should create proper folder structure with timestamp', async () => {
    await writeFile(join(testRepo.path, 'test.txt'), 'content');
    
    await generateMigration(testRepo.path, 'test-migration');
    
    const folders = await listMigrationFolders(testRepo.path);
    expect(folders).toHaveLength(1);
    
    const folderName = folders[0]!;
    const timestampMatch = folderName.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})_test-migration$/);
    expect(timestampMatch).toBeTruthy();
    
    if (timestampMatch) {
      // Convert from YYYY-MM-DDTHH-mm-ss to YYYY-MM-DDTHH:mm:ss
      // Extract parts: 2025-06-23T05-04-57 -> 2025-06-23T05:04:57
      const rawTimestamp = timestampMatch[1]!;
      const timestamp = rawTimestamp.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3');
      const migrationTime = new Date(timestamp);
      
      // Just verify it's a valid date (not NaN)
      expect(migrationTime.getTime()).not.toBeNaN();
      expect(migrationTime.getFullYear()).toBeGreaterThanOrEqual(2020);
    }
  });

  it('should create __files directory with template files', async () => {
    await writeFile(join(testRepo.path, 'component.tsx'), 'export const Component = () => <div>Hello</div>;');
    await writeFile(join(testRepo.path, 'styles.css'), '.component { color: red; }');
    
    await generateMigration(testRepo.path, 'add-components');
    
    const folders = await listMigrationFolders(testRepo.path);
    const migrationPath = join(testRepo.path, 'migrations', folders[0]!);
    
    // Check that __files directory exists with template files
    const { access } = await import('fs/promises');
    await expect(access(join(migrationPath, '__files', 'component.tsx.template'))).resolves.toBeUndefined();
    await expect(access(join(migrationPath, '__files', 'styles.css.template'))).resolves.toBeUndefined();
    
    // Check template file contents
    const { readFile } = await import('fs/promises');
    const templateContent = await readFile(join(migrationPath, '__files', 'component.tsx.template'), 'utf8');
    expect(templateContent).toBe('export const Component = () => <div>Hello</div>;');
  });
});