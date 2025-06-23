import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { checkPendingMigrations } from '../../commands/check.js';
import { generateMigration } from '../../commands/generate.js';
import { createTestRepo } from '../test-helpers.js';

describe('check command', () => {
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
    await checkPendingMigrations(projectRepo.path);
    
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
    
    await checkPendingMigrations(projectRepo.path);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('❌ Template path not found: /non-existent/path')
    );
  });

  it('should show no pending migrations when up to date', async () => {
    // Create template with migration
    await writeFile(join(templateRepo.path, 'README.md'), '# Template');
    await generateMigration(templateRepo.path, 'initial');
    
    // Create applied-migrations.json with all migrations applied
    const appliedMigrationsFile = {
      version: '1.0.0',
      template: templateRepo.path,
      appliedMigrations: [
        {
          name: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_initial$/),
          timestamp: expect.any(String),
          appliedAt: new Date().toISOString()
        }
      ]
    };
    
    // Get the actual migration name
    const { getAllMigrationDirectories } = await import('../../utils/state-utils.js');
    const migrations = getAllMigrationDirectories(templateRepo.path);
    appliedMigrationsFile.appliedMigrations[0]!.name = migrations[0]!.name;
    appliedMigrationsFile.appliedMigrations[0]!.timestamp = migrations[0]!.timestamp;
    
    await writeFile(
      join(projectRepo.path, 'applied-migrations.json'),
      JSON.stringify(appliedMigrationsFile, null, 2)
    );
    
    await checkPendingMigrations(projectRepo.path);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      '✅ No pending migrations found. You are up to date!'
    );
  });

  it('should show pending migrations when template has new migrations', async () => {
    // Create template with initial migration
    await writeFile(join(templateRepo.path, 'README.md'), '# Template');
    await generateMigration(templateRepo.path, 'initial');
    
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
    
    await checkPendingMigrations(projectRepo.path);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('📋 Found 1 pending migration(s):')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('initial')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("💡 Run 'update' to apply pending migrations.")
    );
  });

  it('should show multiple pending migrations', async () => {
    // Create template with multiple migrations
    await writeFile(join(templateRepo.path, 'README.md'), '# Template');
    await generateMigration(templateRepo.path, 'initial');
    
    await writeFile(join(templateRepo.path, 'package.json'), '{"name": "test"}');
    await generateMigration(templateRepo.path, 'add-package');
    
    await mkdir(join(templateRepo.path, 'src'), { recursive: true });
    await writeFile(join(templateRepo.path, 'src/index.ts'), 'console.log("hello");');
    await generateMigration(templateRepo.path, 'add-src');
    
    // Create applied-migrations.json with only first migration applied
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
    
    await checkPendingMigrations(projectRepo.path);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('📋 Found 2 pending migration(s):')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('add-package')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('add-src')
    );
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
    
    await checkPendingMigrations(projectRepo.path);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      '✅ No pending migrations found. You are up to date!'
    );
  });
});