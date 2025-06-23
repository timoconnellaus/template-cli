import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { applyMigration, copyTemplate } from '../../utils/template-utils.js';
import { createTestRepo } from '../test-helpers.js';

describe('template-utils', () => {
  let templateRepo: { path: string; cleanup: () => Promise<void> };
  let targetRepo: { path: string; cleanup: () => Promise<void> };

  beforeEach(async () => {
    templateRepo = await createTestRepo();
    targetRepo = await createTestRepo();
  });

  afterEach(async () => {
    await templateRepo.cleanup();
    await targetRepo.cleanup();
  });

  describe('copyTemplate', () => {
    it('should copy template files excluding migrations directory', async () => {
      // Create template structure
      await writeFile(join(templateRepo.path, 'README.md'), '# Template');
      await writeFile(join(templateRepo.path, 'package.json'), '{"name": "test"}');
      await mkdir(join(templateRepo.path, 'src'));
      await writeFile(join(templateRepo.path, 'src', 'index.ts'), 'console.log("hello");');
      
      // Create migrations directory (should be excluded)
      await mkdir(join(templateRepo.path, 'migrations'));
      await writeFile(join(templateRepo.path, 'migrations', 'test.txt'), 'should not copy');
      
      await copyTemplate(templateRepo.path, targetRepo.path);
      
      // Verify files were copied
      const readmeContent = await readFile(join(targetRepo.path, 'README.md'), 'utf8');
      expect(readmeContent).toBe('# Template');
      
      const packageContent = await readFile(join(targetRepo.path, 'package.json'), 'utf8');
      expect(packageContent).toBe('{"name": "test"}');
      
      const indexContent = await readFile(join(targetRepo.path, 'src', 'index.ts'), 'utf8');
      expect(indexContent).toBe('console.log("hello");');
      
      // Verify migrations directory was not copied
      const { stat } = await import('fs/promises');
      let migrationsExists = false;
      try {
        await stat(join(targetRepo.path, 'migrations'));
        migrationsExists = true;
      } catch (error) {
        // Expected - migrations should not exist
      }
      expect(migrationsExists).toBe(false);
    });

    it('should handle nested directory structures', async () => {
      // Create complex template structure
      await mkdir(join(templateRepo.path, 'src', 'components'), { recursive: true });
      await mkdir(join(templateRepo.path, 'docs', 'api'), { recursive: true });
      
      await writeFile(join(templateRepo.path, 'src', 'index.ts'), 'export * from "./components";');
      await writeFile(join(templateRepo.path, 'src', 'components', 'Button.tsx'), 'export const Button = () => <button />;');
      await writeFile(join(templateRepo.path, 'docs', 'README.md'), '# Documentation');
      await writeFile(join(templateRepo.path, 'docs', 'api', 'reference.md'), '# API Reference');
      
      await copyTemplate(templateRepo.path, targetRepo.path);
      
      // Verify all files were copied correctly
      const indexContent = await readFile(join(targetRepo.path, 'src', 'index.ts'), 'utf8');
      expect(indexContent).toBe('export * from "./components";');
      
      const buttonContent = await readFile(join(targetRepo.path, 'src', 'components', 'Button.tsx'), 'utf8');
      expect(buttonContent).toBe('export const Button = () => <button />;');
      
      const docsContent = await readFile(join(targetRepo.path, 'docs', 'README.md'), 'utf8');
      expect(docsContent).toBe('# Documentation');
      
      const apiContent = await readFile(join(targetRepo.path, 'docs', 'api', 'reference.md'), 'utf8');
      expect(apiContent).toBe('# API Reference');
    });
  });

  describe('applyMigration', () => {
    it('should apply migration with new files', async () => {
      // Create migration directory structure
      const migrationsDir = join(templateRepo.path, 'migrations');
      await mkdir(migrationsDir, { recursive: true });
      const migrationDir = join(migrationsDir, 'test-migration');
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
      
      await applyMigration(templateRepo.path, targetRepo.path, 'test-migration');
      
      // Verify files were created
      const testContent = await readFile(join(targetRepo.path, 'test.txt'), 'utf8');
      expect(testContent).toBe('Hello World');
      
      const configContent = await readFile(join(targetRepo.path, 'config.json'), 'utf8');
      expect(configContent).toBe('{"setting": "value"}');
    });

    it('should apply migration with file modifications', async () => {
      // Create initial file
      await writeFile(join(targetRepo.path, 'test.txt'), 'line 1\nline 2\nline 3');
      
      // Create migration directory
      const migrationsDir = join(templateRepo.path, 'migrations');
      await mkdir(migrationsDir, { recursive: true });
      const migrationDir = join(migrationsDir, 'test-migration');
      await mkdir(migrationDir, { recursive: true });
      
      // Create migration file that modifies the existing file
      const migrationContent = `// Migration generated automatically
export const migration = {
  'test.txt': {
    type: 'modify',
    diffs: [
      {
        operation: 'replace',
        startLine: 2,
        endLine: 2,
        oldContent: 'line 2',
        newContent: 'modified line 2'
      }
    ]
  }
} as const;`;
      await writeFile(join(migrationDir, 'migrate.ts'), migrationContent);
      
      await applyMigration(templateRepo.path, targetRepo.path, 'test-migration');
      
      // Verify file was modified
      const content = await readFile(join(targetRepo.path, 'test.txt'), 'utf8');
      expect(content).toBe('line 1\nmodified line 2\nline 3');
    });

    it('should apply migration with file deletions', async () => {
      // Create initial files
      await writeFile(join(targetRepo.path, 'keep.txt'), 'keep this');
      await writeFile(join(targetRepo.path, 'delete.txt'), 'delete this');
      
      // Create migration directory
      const migrationsDir = join(templateRepo.path, 'migrations');
      await mkdir(migrationsDir, { recursive: true });
      const migrationDir = join(migrationsDir, 'test-migration');
      await mkdir(migrationDir, { recursive: true });
      
      // Create migration file that deletes a file
      const migrationContent = `// Migration generated automatically
export const migration = {
  'delete.txt': {
    type: 'delete',
    path: 'delete.txt'
  }
} as const;`;
      await writeFile(join(migrationDir, 'migrate.ts'), migrationContent);
      
      await applyMigration(templateRepo.path, targetRepo.path, 'test-migration');
      
      // Verify keep.txt still exists
      const keepContent = await readFile(join(targetRepo.path, 'keep.txt'), 'utf8');
      expect(keepContent).toBe('keep this');
      
      // Verify delete.txt was removed
      const { stat } = await import('fs/promises');
      let deleteExists = false;
      try {
        await stat(join(targetRepo.path, 'delete.txt'));
        deleteExists = true;
      } catch (error) {
        // Expected - file should be deleted
      }
      expect(deleteExists).toBe(false);
    });

    it('should handle migrations with nested file paths', async () => {
      // Create migration directory structure
      const migrationsDir = join(templateRepo.path, 'migrations');
      await mkdir(migrationsDir, { recursive: true });
      const migrationDir = join(migrationsDir, 'test-migration');
      await mkdir(migrationDir, { recursive: true });
      
      const filesDir = join(migrationDir, '__files');
      await mkdir(filesDir, { recursive: true });
      
      // Create nested template file structure
      await mkdir(join(filesDir, 'src', 'components'), { recursive: true });
      await writeFile(join(filesDir, 'src', 'components', 'Button.tsx.template'), 'export const Button = () => <button />;');
      
      // Create migration file
      const migrationContent = `// Migration generated automatically
export const migration = {
  'src/components/Button.tsx': {
    type: 'new',
    path: 'src/components/Button.tsx'
  }
} as const;`;
      await writeFile(join(migrationDir, 'migrate.ts'), migrationContent);
      
      await applyMigration(templateRepo.path, targetRepo.path, 'test-migration');
      
      // Verify nested file was created
      const buttonContent = await readFile(join(targetRepo.path, 'src', 'components', 'Button.tsx'), 'utf8');
      expect(buttonContent).toBe('export const Button = () => <button />;');
    });
  });
});