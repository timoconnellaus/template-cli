import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { updateFromTemplate } from '../../commands/update.js';
import { generateMigration } from '../../commands/generate.js';
import { createTestRepo } from '../test-helpers.js';

describe('update command', () => {
  let templateRepo: { path: string; cleanup: () => Promise<void> };
  let projectRepo: { path: string; cleanup: () => Promise<void> };
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    templateRepo = await createTestRepo();
    projectRepo = await createTestRepo();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    await templateRepo.cleanup();
    await projectRepo.cleanup();
    consoleSpy.mockRestore();
  });

  it('should show error when applied-migrations.json does not exist', async () => {
    await updateFromTemplate(projectRepo.path);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      "❌ No applied-migrations.json found. Run 'init' first to initialize from a template."
    );
  });

  it('should show error when template path does not exist', async () => {
    // Create applied-migrations.json with invalid template path
    const appliedMigrationsFile = {
      version: '1.0.0',
      template: '/non-existent/path',
      appliedMigrations: []
    };
    
    await writeFile(
      join(projectRepo.path, 'applied-migrations.json'),
      JSON.stringify(appliedMigrationsFile, null, 2)
    );
    
    await updateFromTemplate(projectRepo.path);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('❌ Template path not found: /non-existent/path')
    );
  });

  it('should show no pending migrations when up to date', async () => {
    // Create template with migration
    await writeFile(join(templateRepo.path, 'README.md'), '# Template');
    await generateMigration(templateRepo.path, 'initial');
    
    // Create applied-migrations.json with all migrations applied
    const { getAllMigrationDirectories } = await import('../../utils/state-utils.js');
    const migrations = getAllMigrationDirectories(templateRepo.path);
    
    const appliedMigrationsFile = {
      version: '1.0.0',
      template: templateRepo.path,
      appliedMigrations: [
        {
          name: migrations[0]!.name,
          timestamp: migrations[0]!.timestamp,
          appliedAt: new Date().toISOString()
        }
      ]
    };
    
    await writeFile(
      join(projectRepo.path, 'applied-migrations.json'),
      JSON.stringify(appliedMigrationsFile, null, 2)
    );
    
    await updateFromTemplate(projectRepo.path);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      '✅ No pending migrations found. You are already up to date!'
    );
  });

  it('should apply pending migrations and update applied-migrations.json', async () => {
    // Create template with migrations
    await writeFile(join(templateRepo.path, 'README.md'), '# Template');
    await generateMigration(templateRepo.path, 'initial');
    
    await writeFile(join(templateRepo.path, 'package.json'), '{"name": "test"}');
    await generateMigration(templateRepo.path, 'add-package');
    
    // Create applied-migrations.json with no migrations applied
    const appliedMigrationsFile = {
      version: '1.0.0',
      template: templateRepo.path,
      appliedMigrations: []
    };
    
    await writeFile(
      join(projectRepo.path, 'applied-migrations.json'),
      JSON.stringify(appliedMigrationsFile, null, 2)
    );
    
    await updateFromTemplate(projectRepo.path);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('🔄 Applying 2 pending migration(s)...')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('🎉 Successfully applied 2 migration(s).')
    );
    
    // Check that applied-migrations.json was updated
    const updatedContent = await readFile(
      join(projectRepo.path, 'applied-migrations.json'),
      'utf8'
    );
    const updatedData = JSON.parse(updatedContent);
    expect(updatedData.appliedMigrations).toHaveLength(2);
    
    // Check that we have both expected migrations (order may vary due to timestamps)
    const migrationNames = updatedData.appliedMigrations.map((m: any) => m.name);
    expect(migrationNames.some((name: string) => name.includes('initial'))).toBe(true);
    expect(migrationNames.some((name: string) => name.includes('add-package'))).toBe(true);
  });

  it('should apply only new migrations when some are already applied', async () => {
    // Create template with multiple migrations
    await writeFile(join(templateRepo.path, 'README.md'), '# Template');
    await generateMigration(templateRepo.path, 'initial');
    
    await writeFile(join(templateRepo.path, 'package.json'), '{"name": "test"}');
    await generateMigration(templateRepo.path, 'add-package');
    
    await mkdir(join(templateRepo.path, 'src'), { recursive: true });
    await writeFile(join(templateRepo.path, 'src/index.ts'), 'console.log("hello");');
    await generateMigration(templateRepo.path, 'add-src');
    
    // Create applied-migrations.json with first two migrations applied
    const { getAllMigrationDirectories } = await import('../../utils/state-utils.js');
    const migrations = getAllMigrationDirectories(templateRepo.path);
    
    const appliedMigrationsFile = {
      version: '1.0.0',
      template: templateRepo.path,
      appliedMigrations: [
        {
          name: migrations[0]!.name,
          timestamp: migrations[0]!.timestamp,
          appliedAt: new Date().toISOString()
        },
        {
          name: migrations[1]!.name,
          timestamp: migrations[1]!.timestamp,
          appliedAt: new Date().toISOString()
        }
      ]
    };
    
    await writeFile(
      join(projectRepo.path, 'applied-migrations.json'),
      JSON.stringify(appliedMigrationsFile, null, 2)
    );
    
    await updateFromTemplate(projectRepo.path);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('🔄 Applying 1 pending migration(s)...')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('add-src')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('🎉 Successfully applied 1 migration(s).')
    );
    
    // Check that applied-migrations.json was updated
    const updatedContent = await readFile(
      join(projectRepo.path, 'applied-migrations.json'),
      'utf8'
    );
    const updatedData = JSON.parse(updatedContent);
    expect(updatedData.appliedMigrations).toHaveLength(3);
    
    // Check that the new migration was applied (should contain 'add-src')
    const migrationNames = updatedData.appliedMigrations.map((m: any) => m.name);
    expect(migrationNames.some((name: string) => name.includes('add-src'))).toBe(true);
  });

  it('should handle template with no migrations directory', async () => {
    // Create template without migrations
    await writeFile(join(templateRepo.path, 'README.md'), '# Simple Template');
    
    // Create applied-migrations.json
    const appliedMigrationsFile = {
      version: '1.0.0',
      template: templateRepo.path,
      appliedMigrations: []
    };
    
    await writeFile(
      join(projectRepo.path, 'applied-migrations.json'),
      JSON.stringify(appliedMigrationsFile, null, 2)
    );
    
    await updateFromTemplate(projectRepo.path);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      '✅ No pending migrations found. You are already up to date!'
    );
  });

  it('should stop on migration error and maintain consistency', async () => {
    // Create template with migrations
    await writeFile(join(templateRepo.path, 'README.md'), '# Template');
    await generateMigration(templateRepo.path, 'initial');
    
    // Create a second migration that might fail (we'll simulate this in the test)
    await writeFile(join(templateRepo.path, 'package.json'), '{"name": "test"}');
    await generateMigration(templateRepo.path, 'add-package');
    
    // Create applied-migrations.json with no migrations applied
    const appliedMigrationsFile = {
      version: '1.0.0',
      template: templateRepo.path,
      appliedMigrations: []
    };
    
    await writeFile(
      join(projectRepo.path, 'applied-migrations.json'),
      JSON.stringify(appliedMigrationsFile, null, 2)
    );
    
    // Mock applyMigration to fail on the second migration
    const { applyMigration } = await import('../../utils/template-utils.js');
    const applyMigrationSpy = vi.spyOn(await import('../../utils/template-utils.js'), 'applyMigration');
    
    let callCount = 0;
    applyMigrationSpy.mockImplementation(async (...args) => {
      callCount++;
      if (callCount === 1) {
        // First call succeeds
        return applyMigration(...args);
      } else {
        // Second call fails
        throw new Error('Simulated migration error');
      }
    });
    
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    try {
      await updateFromTemplate(projectRepo.path);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('🔄 Applying 2 pending migration(s)...')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('❌ Failed to apply migration'),
        expect.stringContaining('Simulated migration error')
      );
      
      // Check that only the first migration was applied
      const updatedContent = await readFile(
        join(projectRepo.path, 'applied-migrations.json'),
        'utf8'
      );
      const updatedData = JSON.parse(updatedContent);
      expect(updatedData.appliedMigrations).toHaveLength(1);
      
      // Check that one migration was applied (should contain 'initial' or 'add-package')
      const migrationName = updatedData.appliedMigrations[0].name;
      expect(migrationName.includes('initial') || migrationName.includes('add-package')).toBe(true);
      
    } finally {
      applyMigrationSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});