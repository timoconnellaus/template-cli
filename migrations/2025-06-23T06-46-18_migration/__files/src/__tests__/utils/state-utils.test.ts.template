import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { getAllMigrationDirectories, reconstructStateFromMigrations } from '../../utils/state-utils.js';
import { createTestRepo } from '../test-helpers.js';

describe('state-utils', () => {
  let testRepo: { path: string; cleanup: () => Promise<void> };

  beforeEach(async () => {
    testRepo = await createTestRepo();
  });

  afterEach(async () => {
    await testRepo.cleanup();
  });

  describe('getAllMigrationDirectories', () => {
    it('should return empty array when no migrations directory exists', () => {
      const migrations = getAllMigrationDirectories(testRepo.path);
      expect(migrations).toEqual([]);
    });

    it('should return migration directories sorted by timestamp', async () => {
      // Create migrations directory with test folders
      const migrationsPath = join(testRepo.path, 'migrations');
      await mkdir(migrationsPath, { recursive: true });
      
      // Create migration folders with timestamps
      await mkdir(join(migrationsPath, '2025-01-01T10-00-00_first'));
      await mkdir(join(migrationsPath, '2025-01-02T10-00-00_second'));
      await mkdir(join(migrationsPath, '2025-01-01T09-00-00_earliest'));
      
      const migrations = getAllMigrationDirectories(testRepo.path);
      
      expect(migrations).toHaveLength(3);
      expect(migrations.map(m => m.name)).toEqual([
        '2025-01-01T09-00-00_earliest',
        '2025-01-01T10-00-00_first',
        '2025-01-02T10-00-00_second'
      ]);
      
      expect(migrations[0]!).toEqual({
        name: '2025-01-01T09-00-00_earliest',
        timestamp: '2025-01-01T09-00-00',
        path: join(migrationsPath, '2025-01-01T09-00-00_earliest')
      });
    });

    it('should ignore files without underscore in migration directory', async () => {
      const migrationsPath = join(testRepo.path, 'migrations');
      await mkdir(migrationsPath, { recursive: true });
      
      // Create valid migration folder
      await mkdir(join(migrationsPath, '2025-01-01T10-00-00_valid'));
      // Create invalid files/folders
      await mkdir(join(migrationsPath, 'invalid-folder'));
      await writeFile(join(migrationsPath, 'some-file.txt'), 'content');
      
      const migrations = getAllMigrationDirectories(testRepo.path);
      
      expect(migrations).toHaveLength(1);
      expect(migrations[0]!.name).toBe('2025-01-01T10-00-00_valid');
    });
  });

  describe('reconstructStateFromMigrations', () => {
    it('should return empty state when no migrations exist', async () => {
      const migrationsPath = join(testRepo.path, 'migrations');
      const state = await reconstructStateFromMigrations(migrationsPath);
      expect(state).toEqual({});
    });

    it('should reconstruct state from new file migrations', async () => {
      const migrationsPath = join(testRepo.path, 'migrations');
      await mkdir(migrationsPath, { recursive: true });
      
      // Create a migration with new files
      const migrationDir = join(migrationsPath, '2025-01-01T10-00-00_add-files');
      await mkdir(migrationDir, { recursive: true });
      
      const filesDir = join(migrationDir, '__files');
      await mkdir(filesDir, { recursive: true });
      
      // Create template files
      await writeFile(join(filesDir, 'test.txt.template'), 'Hello World');
      await writeFile(join(filesDir, 'config.json.template'), '{"setting": "value"}');
      
      // Create migration file
      const migrationContent = `// Migration generated automatically
export const migration = {
  'test.txt': {
    type: 'new',
    path: 'test.txt'
  },
  'config.json': {
    type: 'new',
    path: 'config.json'
  }
} as const;`;
      await writeFile(join(migrationDir, 'migrate.ts'), migrationContent);
      
      const state = await reconstructStateFromMigrations(migrationsPath);
      
      expect(state['test.txt']).toBe('Hello World');
      expect(state['config.json']).toBe('{"setting": "value"}');
    });

    it('should handle malformed migration files gracefully', async () => {
      const migrationsPath = join(testRepo.path, 'migrations');
      await mkdir(migrationsPath, { recursive: true });
      
      // Create a migration with invalid TypeScript
      const migrationDir = join(migrationsPath, '2025-01-01T10-00-00_invalid');
      await mkdir(migrationDir, { recursive: true });
      
      await writeFile(join(migrationDir, 'migrate.ts'), 'invalid typescript content {{{');
      
      // Should not throw and return empty state
      const state = await reconstructStateFromMigrations(migrationsPath);
      expect(state).toEqual({});
    });
  });
});