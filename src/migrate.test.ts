import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  createTestRepo, 
  addFileToRepo, 
  commitToRepo, 
  modifyFileInRepo,
  deleteFileFromRepo,
  readMigrationFile,
  listMigrationFolders,
  TestRepo
} from './test-helpers.js';
import { generateMigrations } from './migrate.js';

describe('Migration Generator', () => {
  let testRepo: TestRepo;

  beforeEach(async () => {
    testRepo = await createTestRepo();
  });

  afterEach(async () => {
    await testRepo.cleanup();
  });

  it('should create migrations folder', async () => {
    await addFileToRepo(testRepo, 'test.txt', 'Hello World');
    await commitToRepo(testRepo, 'Initial commit');
    
    await generateMigrations(testRepo.path);
    
    const folders = await listMigrationFolders(testRepo.path);
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatch(/^01_latest$/);
  });

  it('should create migration for new file', async () => {
    await addFileToRepo(testRepo, 'test.txt', 'Hello World');
    await commitToRepo(testRepo, 'Add test file');
    
    await generateMigrations(testRepo.path);
    
    const migration = await readMigrationFile(testRepo.path, '01_latest');
    expect(migration).toHaveProperty('test.txt');
    expect(migration['test.txt']).toBe('Hello World');
  });

  it('should create migration for multiple files', async () => {
    await addFileToRepo(testRepo, 'file1.txt', 'Content 1');
    await addFileToRepo(testRepo, 'file2.txt', 'Content 2');
    await commitToRepo(testRepo, 'Add multiple files');
    
    await generateMigrations(testRepo.path);
    
    const migration = await readMigrationFile(testRepo.path, '01_latest');
    expect(migration).toHaveProperty('file1.txt', 'Content 1');
    expect(migration).toHaveProperty('file2.txt', 'Content 2');
  });

  it('should create migration for file modification', async () => {
    // First commit
    await addFileToRepo(testRepo, 'test.txt', 'Original content');
    await commitToRepo(testRepo, 'Initial commit');
    
    // Second commit - modify file
    await modifyFileInRepo(testRepo, 'test.txt', 'Modified content');
    await commitToRepo(testRepo, 'Modify file');
    
    await generateMigrations(testRepo.path);
    
    const folders = await listMigrationFolders(testRepo.path);
    expect(folders).toHaveLength(2);
    
    // Check first migration (original file)
    const firstMigration = await readMigrationFile(testRepo.path, folders[0]);
    expect(firstMigration).toHaveProperty('test.txt', 'Original content');
    
    // Check second migration (modification)
    const secondMigration = await readMigrationFile(testRepo.path, folders[1]);
    expect(secondMigration).toHaveProperty('test.txt');
    expect(Array.isArray(secondMigration['test.txt'])).toBe(true);
  });

  it('should create migration for file deletion', async () => {
    // First commit
    await addFileToRepo(testRepo, 'test.txt', 'Content to delete');
    await commitToRepo(testRepo, 'Initial commit');
    
    // Second commit - delete file
    await deleteFileFromRepo(testRepo, 'test.txt');
    await commitToRepo(testRepo, 'Delete file');
    
    await generateMigrations(testRepo.path);
    
    const folders = await listMigrationFolders(testRepo.path);
    expect(folders).toHaveLength(2);
    
    // Check second migration (deletion)
    const secondMigration = await readMigrationFile(testRepo.path, folders[1]);
    expect(secondMigration).toHaveProperty('test.txt');
    expect(secondMigration['test.txt']).toEqual({ deleted: true });
  });

  it('should handle complex workflow with multiple commits', async () => {
    // Commit 1: Add initial files
    await addFileToRepo(testRepo, 'file1.txt', 'Initial content 1');
    await addFileToRepo(testRepo, 'file2.txt', 'Initial content 2');
    await commitToRepo(testRepo, 'Initial commit');
    
    // Commit 2: Modify one file, add another
    await modifyFileInRepo(testRepo, 'file1.txt', 'Modified content 1');
    await addFileToRepo(testRepo, 'file3.txt', 'New file content');
    await commitToRepo(testRepo, 'Modify and add files');
    
    // Commit 3: Delete one file
    await deleteFileFromRepo(testRepo, 'file2.txt');
    await commitToRepo(testRepo, 'Delete file');
    
    await generateMigrations(testRepo.path);
    
    const folders = await listMigrationFolders(testRepo.path);
    expect(folders).toHaveLength(3);
    
    // Verify folder naming
    expect(folders[0]).toMatch(/^01_/);
    expect(folders[1]).toMatch(/^02_/);
    expect(folders[2]).toMatch(/^03_latest$/);
    
    // Check migrations
    const firstMigration = await readMigrationFile(testRepo.path, folders[0]);
    expect(firstMigration).toHaveProperty('file1.txt', 'Initial content 1');
    expect(firstMigration).toHaveProperty('file2.txt', 'Initial content 2');
    
    const secondMigration = await readMigrationFile(testRepo.path, folders[1]);
    expect(Array.isArray(secondMigration['file1.txt'])).toBe(true);
    expect(secondMigration).toHaveProperty('file3.txt', 'New file content');
    
    const thirdMigration = await readMigrationFile(testRepo.path, folders[2]);
    expect(thirdMigration).toHaveProperty('file2.txt', { deleted: true });
  });

  it('should update latest migration when run multiple times', async () => {
    // Initial commit
    await addFileToRepo(testRepo, 'test.txt', 'Initial content');
    await commitToRepo(testRepo, 'Initial commit');
    
    // Run first time
    await generateMigrations(testRepo.path);
    let folders = await listMigrationFolders(testRepo.path);
    expect(folders).toHaveLength(1);
    expect(folders[0]).toBe('01_latest');
    
    // Add another commit
    await addFileToRepo(testRepo, 'test2.txt', 'Second file');
    await commitToRepo(testRepo, 'Second commit');
    
    // Run again
    await generateMigrations(testRepo.path);
    folders = await listMigrationFolders(testRepo.path);
    expect(folders).toHaveLength(2);
    
    // The first should now have a hash, the second should be latest
    expect(folders[0]).toMatch(/^01_[a-f0-9]+$/);
    expect(folders[1]).toBe('02_latest');
  });

  it('should handle nested file paths', async () => {
    await addFileToRepo(testRepo, 'src/components/Button.tsx', 'export const Button = () => <button>Click</button>;');
    await addFileToRepo(testRepo, 'src/utils/helpers.ts', 'export const helper = () => {};');
    await commitToRepo(testRepo, 'Add nested files');
    
    await generateMigrations(testRepo.path);
    
    const migration = await readMigrationFile(testRepo.path, '01_latest');
    expect(migration).toHaveProperty('src/components/Button.tsx');
    expect(migration).toHaveProperty('src/utils/helpers.ts');
    expect(migration['src/components/Button.tsx']).toBe('export const Button = () => <button>Click</button>;');
  });
});