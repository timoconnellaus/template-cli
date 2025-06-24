import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { writeFile, mkdir, rm, readFile, copyFile } from 'fs/promises';
import { generateMigration } from '../../commands/generate.js';
import { createTestRepo, listMigrationFolders, readMigrationFile } from '../test-helpers.js';

// Mock inquirer for non-interactive testing
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn()
}));

describe('Binary File Migration Integration', () => {
  let testRepo: { path: string; cleanup: () => Promise<void> };
  let mockSelect: any;
  let mockConfirm: any;

  beforeEach(async () => {
    testRepo = await createTestRepo();
    
    // Setup inquirer mocks
    const prompts = await import('@inquirer/prompts');
    mockSelect = vi.mocked(prompts.select);
    mockConfirm = vi.mocked(prompts.confirm);
    
    // Default to not detecting moves for testing
    mockConfirm.mockResolvedValue(false);
  });

  afterEach(async () => {
    await testRepo.cleanup();
    vi.clearAllMocks();
  });

  // Helper to create a binary file with specific content
  async function createBinaryFile(path: string, content: number[]): Promise<void> {
    const buffer = Buffer.from(content);
    await writeFile(path, buffer);
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
      case 'ico':
        // ICO header with null bytes
        return [0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x20, 0x20, 0x00, 0x00];
      case 'simple':
        // Simple binary data with null bytes
        return [0x01, 0x02, 0x03, 0x00, 0x04, 0x05, 0x06, 0x00];
      default:
        // Default binary data with lots of non-printable chars
        return [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0B, 0x0C, 0x0E, 0x0F];
    }
  }

  // Helper to read binary file content
  async function readBinaryFile(path: string): Promise<number[]> {
    const buffer = await readFile(path);
    return Array.from(buffer);
  }

  describe('Binary file addition', () => {
    it('should generate migration for new binary file', async () => {
      // Create a binary file (PNG header signature)
      const pngHeader = createBinaryData('png');
      await createBinaryFile(join(testRepo.path, 'image.png'), pngHeader);
      
      // Generate migration
      await generateMigration(testRepo.path, 'add-binary');
      
      // Check migration was created
      const folders = await listMigrationFolders(testRepo.path);
      expect(folders).toHaveLength(1);
      
      // Read migration content
      const migration = await readMigrationFile(testRepo.path, folders[0]!);
      expect(migration['image.png']).toEqual({
        type: 'binary',
        path: 'image.png',
        isBinary: true
      });
      
      // Check that binary file was copied to __files
      const binaryFilePath = join(testRepo.path, 'migrations', folders[0]!, '__files', 'image.png.binary');
      const storedContent = await readBinaryFile(binaryFilePath);
      expect(storedContent).toEqual(pngHeader);
    });

    it('should handle multiple binary files in single migration', async () => {
      // Create multiple binary files
      const pngHeader = createBinaryData('png');
      const jpegHeader = createBinaryData('jpeg');
      
      await createBinaryFile(join(testRepo.path, 'image.png'), pngHeader);
      await createBinaryFile(join(testRepo.path, 'photo.jpg'), jpegHeader);
      
      // Generate migration
      await generateMigration(testRepo.path, 'add-multiple-binary');
      
      const folders = await listMigrationFolders(testRepo.path);
      const migration = await readMigrationFile(testRepo.path, folders[0]!);
      
      expect(migration['image.png']).toEqual({
        type: 'binary',
        path: 'image.png',
        isBinary: true
      });
      expect(migration['photo.jpg']).toEqual({
        type: 'binary',
        path: 'photo.jpg',
        isBinary: true
      });
    });

    it('should handle binary files in nested directories', async () => {
      // Create nested directory with binary file
      await mkdir(join(testRepo.path, 'assets', 'images'), { recursive: true });
      const iconData = createBinaryData('ico');
      await createBinaryFile(join(testRepo.path, 'assets', 'images', 'icon.ico'), iconData);
      
      // Generate migration
      await generateMigration(testRepo.path, 'nested-binary');
      
      const folders = await listMigrationFolders(testRepo.path);
      const migration = await readMigrationFile(testRepo.path, folders[0]!);
      
      expect(migration['assets/images/icon.ico']).toEqual({
        type: 'binary',
        path: 'assets/images/icon.ico',
        isBinary: true
      });
    });
  });

  describe('Binary file removal', () => {
    it('should generate migration for deleted binary file', async () => {
      // Create initial binary file and first migration
      const binaryData = createBinaryData('zip');
      await createBinaryFile(join(testRepo.path, 'archive.zip'), binaryData);
      await generateMigration(testRepo.path, 'initial');
      
      // Delete the binary file
      await rm(join(testRepo.path, 'archive.zip'));
      
      // Wait a small amount to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Generate second migration
      await generateMigration(testRepo.path, 'delete-binary');
      
      const folders = await listMigrationFolders(testRepo.path);
      expect(folders).toHaveLength(2);
      
      // Check second migration
      const migration = await readMigrationFile(testRepo.path, folders[1]!);
      expect(migration['archive.zip']).toEqual({
        type: 'delete',
        path: 'archive.zip'
      });
    });
  });

  describe('Binary file modification', () => {
    it('should generate migration for modified binary file', async () => {
      // Create initial binary file and first migration
      const originalData = createBinaryData('zip');
      await createBinaryFile(join(testRepo.path, 'data.bin'), originalData);
      await generateMigration(testRepo.path, 'initial');
      
      // Modify the binary file (different content)
      const modifiedData = [...createBinaryData('zip'), 0x14, 0x00]; // Extended ZIP header
      await createBinaryFile(join(testRepo.path, 'data.bin'), modifiedData);
      
      // Wait to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Generate second migration
      await generateMigration(testRepo.path, 'modify-binary');
      
      const folders = await listMigrationFolders(testRepo.path);
      expect(folders).toHaveLength(2);
      
      // Check second migration
      const migration = await readMigrationFile(testRepo.path, folders[1]!);
      expect(migration['data.bin']).toEqual({
        type: 'binary',
        path: 'data.bin',
        isBinary: true
      });
      
      // Verify the new binary content is stored
      const binaryFilePath = join(testRepo.path, 'migrations', folders[1]!, '__files', 'data.bin.binary');
      const storedContent = await readBinaryFile(binaryFilePath);
      expect(storedContent).toEqual(modifiedData);
    });
  });

  describe('Text to binary conversion', () => {
    it('should handle file conversion from text to binary', async () => {
      // Create initial text file and first migration
      await writeFile(join(testRepo.path, 'config.txt'), 'text content');
      await generateMigration(testRepo.path, 'initial');
      
      // Replace with binary file (same name)
      await rm(join(testRepo.path, 'config.txt'));
      const binaryData = createBinaryData('png');
      await createBinaryFile(join(testRepo.path, 'config.txt'), binaryData);
      
      // Generate second migration
      await generateMigration(testRepo.path, 'text-to-binary');
      
      const folders = await listMigrationFolders(testRepo.path);
      expect(folders).toHaveLength(2);
      
      // Check second migration shows binary conversion
      const migration = await readMigrationFile(testRepo.path, folders[1]!);
      expect(migration['config.txt']).toEqual({
        type: 'binary',
        path: 'config.txt',
        isBinary: true
      });
    });
  });

  describe('Binary to text conversion', () => {
    it('should handle file conversion from binary to text', async () => {
      // Create initial binary file and first migration
      const binaryData = createBinaryData('png');
      await createBinaryFile(join(testRepo.path, 'data.bin'), binaryData);
      await generateMigration(testRepo.path, 'initial');
      
      // Replace with text file (same name)
      await rm(join(testRepo.path, 'data.bin'));
      await writeFile(join(testRepo.path, 'data.bin'), 'now text content');
      
      // Wait to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Generate second migration
      await generateMigration(testRepo.path, 'binary-to-text');
      
      const folders = await listMigrationFolders(testRepo.path);
      expect(folders).toHaveLength(2);
      
      // Check second migration shows text conversion
      const migration = await readMigrationFile(testRepo.path, folders[1]!);
      expect(migration['data.bin']).toEqual({
        type: 'new',
        path: 'data.bin'
      });
    });
  });

  describe('Binary file moves', () => {
    it('should handle binary file moves with user confirmation', async () => {
      // Create initial binary file and first migration
      const binaryData = createBinaryData('zip');
      await createBinaryFile(join(testRepo.path, 'old-name.bin'), binaryData);
      await generateMigration(testRepo.path, 'initial');
      
      // Move/rename the binary file
      await rm(join(testRepo.path, 'old-name.bin'));
      await createBinaryFile(join(testRepo.path, 'new-name.bin'), binaryData);
      
      // Mock user selecting the move
      mockConfirm.mockResolvedValueOnce(true); // Confirm it was moved
      mockSelect.mockResolvedValueOnce('new-name.bin'); // Select target file
      
      // Generate second migration
      await generateMigration(testRepo.path, 'move-binary');
      
      const folders = await listMigrationFolders(testRepo.path);
      expect(folders).toHaveLength(2);
      
      // Check second migration shows move
      const migration = await readMigrationFile(testRepo.path, folders[1]!);
      expect(migration['new-name.bin']).toEqual({
        type: 'moved',
        oldPath: 'old-name.bin',
        newPath: 'new-name.bin',
        isBinary: true
      });
    });
  });

  describe('Multiple consecutive migrations with binary files', () => {
    it('should correctly handle generating multiple migrations in a row with binary files', async () => {
      // First migration: add binary file
      const originalData = createBinaryData('png');
      await createBinaryFile(join(testRepo.path, 'image.png'), originalData);
      await generateMigration(testRepo.path, 'add-image');
      
      // Second migration: modify binary file
      const modifiedData = [...createBinaryData('png'), 0x0D, 0x0A];
      await createBinaryFile(join(testRepo.path, 'image.png'), modifiedData);
      
      // Wait to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 1100));
      await generateMigration(testRepo.path, 'update-image');
      
      // Third migration: add another binary file
      const newFileData = createBinaryData('jpeg');
      await createBinaryFile(join(testRepo.path, 'photo.jpg'), newFileData);
      
      // Wait to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 1100));
      await generateMigration(testRepo.path, 'add-photo');
      
      // Should have 3 migrations
      const folders = await listMigrationFolders(testRepo.path);
      expect(folders).toHaveLength(3);
      
      // Check each migration
      const migration1 = await readMigrationFile(testRepo.path, folders[0]!);
      expect(migration1['image.png']).toEqual({
        type: 'binary',
        path: 'image.png',
        isBinary: true
      });
      
      const migration2 = await readMigrationFile(testRepo.path, folders[1]!);
      expect(migration2['image.png']).toEqual({
        type: 'binary',
        path: 'image.png',
        isBinary: true
      });
      
      const migration3 = await readMigrationFile(testRepo.path, folders[2]!);
      expect(migration3['photo.jpg']).toEqual({
        type: 'binary',
        path: 'photo.jpg',
        isBinary: true
      });
    });

    it('should generate no migration when binary files are unchanged', async () => {
      // First migration: add binary file
      const binaryData = createBinaryData('png');
      await createBinaryFile(join(testRepo.path, 'unchanging.bin'), binaryData);
      await generateMigration(testRepo.path, 'initial');
      
      // Attempt second migration without changes
      await generateMigration(testRepo.path, 'no-changes');
      
      // Should still only have 1 migration
      const folders = await listMigrationFolders(testRepo.path);
      expect(folders).toHaveLength(1);
    });
  });

  describe('Mixed binary and text operations', () => {
    it('should handle mixed binary and text file operations in same migration', async () => {
      // Create both text and binary files
      await writeFile(join(testRepo.path, 'readme.txt'), 'Documentation');
      const binaryData = createBinaryData('zip');
      await createBinaryFile(join(testRepo.path, 'archive.zip'), binaryData);
      
      // Generate migration
      await generateMigration(testRepo.path, 'mixed-files');
      
      const folders = await listMigrationFolders(testRepo.path);
      const migration = await readMigrationFile(testRepo.path, folders[0]!);
      
      // Should have both types
      expect(migration['readme.txt']).toEqual({
        type: 'new',
        path: 'readme.txt'
      });
      expect(migration['archive.zip']).toEqual({
        type: 'binary',
        path: 'archive.zip',
        isBinary: true
      });
    });

    it('should handle text modification and binary addition in same migration', async () => {
      // Initial state with text file
      await writeFile(join(testRepo.path, 'config.json'), '{"version": "1.0"}');
      await generateMigration(testRepo.path, 'initial');
      
      // Modify text file and add binary file
      await writeFile(join(testRepo.path, 'config.json'), '{"version": "1.1"}');
      const binaryData = createBinaryData('jpeg');
      await createBinaryFile(join(testRepo.path, 'image.jpg'), binaryData);
      
      // Generate second migration
      await generateMigration(testRepo.path, 'mixed-changes');
      
      const folders = await listMigrationFolders(testRepo.path);
      expect(folders).toHaveLength(2);
      
      const migration = await readMigrationFile(testRepo.path, folders[1]!);
      
      // Should have text modification and binary addition
      expect(migration['config.json']).toEqual({
        type: 'modify',
        diffFile: 'config.json.diff'
      });
      expect(migration['image.jpg']).toEqual({
        type: 'binary',
        path: 'image.jpg',
        isBinary: true
      });
    });
  });

  describe('Binary files with ignore patterns', () => {
    it('should respect .migrateignore patterns for binary files', async () => {
      // Create .migrateignore
      await writeFile(join(testRepo.path, '.migrateignore'), '*.tmp\n*.cache');
      
      // Create binary files - some should be ignored
      const binaryData = createBinaryData('png');
      await createBinaryFile(join(testRepo.path, 'important.png'), binaryData);
      await createBinaryFile(join(testRepo.path, 'temp.tmp'), binaryData);
      await createBinaryFile(join(testRepo.path, 'data.cache'), binaryData);
      
      // Generate migration
      await generateMigration(testRepo.path, 'ignore-test');
      
      const folders = await listMigrationFolders(testRepo.path);
      const migration = await readMigrationFile(testRepo.path, folders[0]!);
      
      // Only important.png should be included
      expect(migration['important.png']).toBeDefined();
      expect(migration['temp.tmp']).toBeUndefined();
      expect(migration['data.cache']).toBeUndefined();
    });

    it('should handle negation patterns for binary files', async () => {
      // Create .migrateignore with negation
      await writeFile(join(testRepo.path, '.migrateignore'), '*.bin\n!important.bin');
      
      // Create binary files
      const binaryData = createBinaryData('zip');
      await createBinaryFile(join(testRepo.path, 'data.bin'), binaryData);
      await createBinaryFile(join(testRepo.path, 'important.bin'), binaryData);
      await createBinaryFile(join(testRepo.path, 'config.txt'), binaryData); // Binary file with txt extension
      
      // Generate migration
      await generateMigration(testRepo.path, 'negation-test');
      
      const folders = await listMigrationFolders(testRepo.path);
      const migration = await readMigrationFile(testRepo.path, folders[0]!);
      
      // Only important.bin and config.txt should be included
      expect(migration['important.bin']).toBeDefined();
      expect(migration['config.txt']).toBeDefined();
      expect(migration['data.bin']).toBeUndefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty binary files', async () => {
      // Create empty binary file
      await writeFile(join(testRepo.path, 'empty.bin'), Buffer.alloc(0));
      
      // Generate migration
      await generateMigration(testRepo.path, 'empty-binary');
      
      const folders = await listMigrationFolders(testRepo.path);
      const migration = await readMigrationFile(testRepo.path, folders[0]!);
      
      expect(migration['empty.bin']).toEqual({
        type: 'binary',
        path: 'empty.bin',
        isBinary: true
      });
    });

    it('should handle large binary files', async () => {
      // Create large binary file (1MB of random data)
      const largeData = new Array(1024 * 1024).fill(0).map((_, i) => i % 256);
      await createBinaryFile(join(testRepo.path, 'large.bin'), largeData);
      
      // Generate migration
      await generateMigration(testRepo.path, 'large-binary');
      
      const folders = await listMigrationFolders(testRepo.path);
      const migration = await readMigrationFile(testRepo.path, folders[0]!);
      
      expect(migration['large.bin']).toEqual({
        type: 'binary',
        path: 'large.bin',
        isBinary: true
      });
    });

    it('should handle binary files with special characters in names', async () => {
      // Create binary file with special characters
      const binaryData = createBinaryData('png');
      await createBinaryFile(join(testRepo.path, 'image with spaces.png'), binaryData);
      await createBinaryFile(join(testRepo.path, 'file-with-dashes.bin'), binaryData);
      
      // Generate migration
      await generateMigration(testRepo.path, 'special-names');
      
      const folders = await listMigrationFolders(testRepo.path);
      const migration = await readMigrationFile(testRepo.path, folders[0]!);
      
      expect(migration['image with spaces.png']).toBeDefined();
      expect(migration['file-with-dashes.bin']).toBeDefined();
    });
  });
});