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

  describe('Binary file migration generation', () => {
    // Helper to create a binary file with specific content
    async function createBinaryFile(path: string, content: number[]): Promise<void> {
      const buffer = Buffer.from(content);
      await writeFile(path, buffer);
    }

    // Helper to read binary file content
    async function readBinaryFile(path: string): Promise<number[]> {
      const { readFile } = await import('fs/promises');
      const buffer = await readFile(path);
      return Array.from(buffer);
    }

    // Helper to create properly detectable binary data
    function createBinaryData(name: string): number[] {
      switch (name) {
        case 'png':
          // Real PNG header with null byte to ensure binary detection
          return [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D];
        case 'jpeg':
          // JPEG header with null bytes
          return [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01];
        case 'zip':
          // ZIP header with null bytes
          return [0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00];
        default:
          // Default binary data with lots of non-printable chars
          return [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0B, 0x0C, 0x0E, 0x0F];
      }
    }

    it('should generate migration for binary file and store binary content', async () => {
      // Create a binary file (PNG header)
      const pngHeader = createBinaryData('png');
      await createBinaryFile(join(testRepo.path, 'test.png'), pngHeader);
      
      // Generate migration
      await generateMigration(testRepo.path, 'add-binary');
      
      // Check migration was created
      const folders = await listMigrationFolders(testRepo.path);
      expect(folders).toHaveLength(1);
      
      // Read migration content
      const migration = await readMigrationFile(testRepo.path, folders[0]!);
      expect(migration['test.png']).toEqual({
        type: 'binary',
        path: 'test.png',
        isBinary: true
      });
      
      // Check that binary file was stored in __files
      const binaryFilePath = join(testRepo.path, 'migrations', folders[0]!, '__files', 'test.png.binary');
      const { access } = await import('fs/promises');
      await expect(access(binaryFilePath)).resolves.toBeUndefined();
      
      // Verify binary content is correct
      const storedContent = await readBinaryFile(binaryFilePath);
      expect(storedContent).toEqual(pngHeader);
    });

    it('should generate consecutive migrations with binary file changes', async () => {
      // Create initial binary file and first migration
      const originalData = createBinaryData('zip');
      await createBinaryFile(join(testRepo.path, 'data.bin'), originalData);
      await generateMigration(testRepo.path, 'initial');
      
      // Modify the binary file
      const modifiedData = [...createBinaryData('zip'), 0x14, 0x00]; // Extended ZIP header
      await createBinaryFile(join(testRepo.path, 'data.bin'), modifiedData);
      
      // Wait to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Generate second migration
      await generateMigration(testRepo.path, 'modify-binary');
      
      // Should have 2 migrations
      const folders = await listMigrationFolders(testRepo.path);
      expect(folders).toHaveLength(2);
      
      // Check first migration
      const migration1 = await readMigrationFile(testRepo.path, folders[0]!);
      expect(migration1['data.bin']).toEqual({
        type: 'binary',
        path: 'data.bin',
        isBinary: true
      });
      
      // Check second migration
      const migration2 = await readMigrationFile(testRepo.path, folders[1]!);
      expect(migration2['data.bin']).toEqual({
        type: 'binary',
        path: 'data.bin',
        isBinary: true
      });
      
      // Verify different binary content is stored in each migration
      const binaryFile1 = join(testRepo.path, 'migrations', folders[0]!, '__files', 'data.bin.binary');
      const binaryFile2 = join(testRepo.path, 'migrations', folders[1]!, '__files', 'data.bin.binary');
      
      const content1 = await readBinaryFile(binaryFile1);
      const content2 = await readBinaryFile(binaryFile2);
      
      expect(content1).toEqual(originalData);
      expect(content2).toEqual(modifiedData);
    });

    it('should handle text to binary file conversion', async () => {
      // Create initial text file and first migration
      await writeFile(join(testRepo.path, 'config.txt'), 'original text content');
      await generateMigration(testRepo.path, 'initial');
      
      // Replace with binary file (same name)
      await rm(join(testRepo.path, 'config.txt'));
      const binaryData = createBinaryData('png');
      await createBinaryFile(join(testRepo.path, 'config.txt'), binaryData);
      
      // Wait to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Generate second migration
      await generateMigration(testRepo.path, 'text-to-binary');
      
      const folders = await listMigrationFolders(testRepo.path);
      expect(folders).toHaveLength(2);
      
      // First migration should be text
      const migration1 = await readMigrationFile(testRepo.path, folders[0]!);
      expect(migration1['config.txt']).toEqual({
        type: 'new',
        path: 'config.txt'
      });
      
      // Second migration should be binary conversion
      const migration2 = await readMigrationFile(testRepo.path, folders[1]!);
      expect(migration2['config.txt']).toEqual({
        type: 'binary',
        path: 'config.txt',
        isBinary: true
      });
    });

    it('should handle binary to text file conversion', async () => {
      // Create initial binary file and first migration
      const binaryData = createBinaryData('jpeg');
      await createBinaryFile(join(testRepo.path, 'data.bin'), binaryData);
      await generateMigration(testRepo.path, 'initial');
      
      // Replace with text file (same name)
      await rm(join(testRepo.path, 'data.bin'));
      await writeFile(join(testRepo.path, 'data.bin'), 'now this is text content');
      
      // Wait to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Generate second migration
      await generateMigration(testRepo.path, 'binary-to-text');
      
      const folders = await listMigrationFolders(testRepo.path);
      expect(folders).toHaveLength(2);
      
      // First migration should be binary
      const migration1 = await readMigrationFile(testRepo.path, folders[0]!);
      expect(migration1['data.bin']).toEqual({
        type: 'binary',
        path: 'data.bin',
        isBinary: true
      });
      
      // Second migration should be new text file
      const migration2 = await readMigrationFile(testRepo.path, folders[1]!);
      expect(migration2['data.bin']).toEqual({
        type: 'new',
        path: 'data.bin'
      });
    });

    it('should detect no changes when binary file is unchanged', async () => {
      // Create binary file and first migration
      const binaryData = createBinaryData('zip');
      await createBinaryFile(join(testRepo.path, 'unchanging.bin'), binaryData);
      await generateMigration(testRepo.path, 'initial');
      
      // Attempt second migration without any changes
      await generateMigration(testRepo.path, 'no-changes');
      
      // Should still only have 1 migration
      const folders = await listMigrationFolders(testRepo.path);
      expect(folders).toHaveLength(1);
    });

    it('should handle mixed text and binary files in same migration', async () => {
      // Create both text and binary files
      await writeFile(join(testRepo.path, 'readme.md'), '# Project Documentation');
      const imageData = createBinaryData('png');
      await createBinaryFile(join(testRepo.path, 'logo.png'), imageData);
      
      // Generate migration
      await generateMigration(testRepo.path, 'mixed-content');
      
      const folders = await listMigrationFolders(testRepo.path);
      const migration = await readMigrationFile(testRepo.path, folders[0]!);
      
      // Should have both types
      expect(migration['readme.md']).toEqual({
        type: 'new',
        path: 'readme.md'
      });
      expect(migration['logo.png']).toEqual({
        type: 'binary',
        path: 'logo.png',
        isBinary: true
      });
      
      // Check that both template and binary files are stored
      const migrationPath = join(testRepo.path, 'migrations', folders[0]!);
      const { access } = await import('fs/promises');
      await expect(access(join(migrationPath, '__files', 'readme.md.template'))).resolves.toBeUndefined();
      await expect(access(join(migrationPath, '__files', 'logo.png.binary'))).resolves.toBeUndefined();
    });
  });
});