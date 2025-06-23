import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { parseMigrationFile, writeMigrationFile } from '../../utils/migration-utils.js';
import { createTestRepo } from '../test-helpers.js';

describe('migration-utils', () => {
  let testRepo: { path: string; cleanup: () => Promise<void> };

  beforeEach(async () => {
    testRepo = await createTestRepo();
  });

  afterEach(async () => {
    await testRepo.cleanup();
  });

  describe('parseMigrationFile', () => {
    it('should parse migration file with new files', async () => {
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
      
      const migration = await parseMigrationFile(migrationContent);
      
      expect(migration['test.txt']).toEqual({
        type: 'new',
        path: 'test.txt'
      });
      expect(migration['config.json']).toEqual({
        type: 'new',
        path: 'config.json'
      });
    });

    it('should parse migration file with modified files', async () => {
      const migrationContent = `// Migration generated automatically
export const migration = {
  'test.txt': {
    type: 'modify',
    diffs: [
      {
        operation: 'replace',
        startLine: 1,
        endLine: 1,
        oldContent: 'old content',
        newContent: 'new content'
      }
    ]
  }
} as const;`;
      
      const migration = await parseMigrationFile(migrationContent);
      
      expect(migration['test.txt']).toEqual({
        type: 'modify',
        diffs: [
          {
            operation: 'replace',
            startLine: 1,
            endLine: 1,
            oldContent: 'old content',
            newContent: 'new content'
          }
        ]
      });
    });

    it('should parse migration file with deleted files', async () => {
      const migrationContent = `// Migration generated automatically
export const migration = {
  'old-file.txt': {
    type: 'delete',
    path: 'old-file.txt'
  }
} as const;`;
      
      const migration = await parseMigrationFile(migrationContent);
      
      expect(migration['old-file.txt']).toEqual({
        type: 'delete',
        path: 'old-file.txt'
      });
    });

    it('should handle empty migration', async () => {
      const migrationContent = `// Migration generated automatically
export const migration = {
} as const;`;
      
      const migration = await parseMigrationFile(migrationContent);
      
      expect(migration).toEqual({});
    });
  });

  describe('writeMigrationFile', () => {
    it('should write migration file with proper TypeScript format', async () => {
      const migrationPath = join(testRepo.path, 'migrate.ts');
      const migration = {
        'test.txt': {
          type: 'new' as const,
          path: 'test.txt'
        },
        'config.json': {
          type: 'modify' as const,
          diffs: [
            {
              operation: 'replace' as const,
              startLine: 1,
              endLine: 1,
              oldContent: 'old',
              newContent: 'new'
            }
          ]
        }
      };
      
      await writeMigrationFile(migrationPath, migration);
      
      // Read the written file and verify it's valid TypeScript
      const { readFile } = await import('fs/promises');
      const content = await readFile(migrationPath, 'utf8');
      
      expect(content).toContain('export const migration');
      expect(content).toContain('"type": "new"');
      expect(content).toContain('"type": "modify"');
      expect(content).toContain('test.txt');
      expect(content).toContain('config.json');
    });

    it('should write empty migration file correctly', async () => {
      const migrationPath = join(testRepo.path, 'migrate.ts');
      const migration = {};
      
      await writeMigrationFile(migrationPath, migration);
      
      const { readFile } = await import('fs/promises');
      const content = await readFile(migrationPath, 'utf8');
      
      expect(content).toContain('export const migration');
      expect(content).toContain('} as const;');
    });

    it('should handle complex migration with all types', async () => {
      const migrationPath = join(testRepo.path, 'migrate.ts');
      const migration = {
        'new-file.txt': {
          type: 'new' as const,
          path: 'new-file.txt'
        },
        'modified-file.txt': {
          type: 'modify' as const,
          diffs: [
            {
              operation: 'insert' as const,
              startLine: 2,
              endLine: 2,
              newContent: 'inserted line'
            },
            {
              operation: 'delete' as const,
              startLine: 3,
              endLine: 3,
              oldContent: 'deleted line'
            }
          ]
        },
        'deleted-file.txt': {
          type: 'delete' as const,
          path: 'deleted-file.txt'
        },
        'moved-file.txt': {
          type: 'moved' as const,
          oldPath: 'old-location.txt',
          newPath: 'moved-file.txt',
          diffs: []
        }
      };
      
      await writeMigrationFile(migrationPath, migration);
      
      const { readFile } = await import('fs/promises');
      const content = await readFile(migrationPath, 'utf8');
      
      expect(content).toContain('"type": "new"');
      expect(content).toContain('"type": "modify"');
      expect(content).toContain('"type": "delete"');
      expect(content).toContain('"type": "moved"');
      expect(content).toContain('new-file.txt');
      expect(content).toContain('modified-file.txt');
      expect(content).toContain('deleted-file.txt');
      expect(content).toContain('moved-file.txt');
    });
  });
});