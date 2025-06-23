import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { writeFile, mkdir, rm } from 'fs/promises';
import { generateMigration } from '../../commands/generate.js';
import { createTestRepo, listMigrationFolders, readMigrationFile } from '../test-helpers.js';

describe('generate command', () => {
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
      diffFile: 'test.txt.diff'
    });
    
    // Check diff file exists and contains expected content
    const { readFile } = await import('fs/promises');
    const diffPath = join(testRepo.path, 'migrations', folders[1]!, '__files', 'test.txt.diff');
    const diffContent = await readFile(diffPath, 'utf8');
    
    expect(diffContent).toContain('@@'); // Unified diff format
    expect(diffContent).toContain('-original content');
    expect(diffContent).toContain('+modified content');
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