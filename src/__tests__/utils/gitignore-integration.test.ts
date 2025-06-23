import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { generateMigration } from '../../commands/generate.js';
import { createTestRepo, type TestRepo } from '../test-helpers.js';

describe('gitignore integration', () => {
  let repo: TestRepo;

  beforeEach(async () => {
    repo = await createTestRepo();
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it('should respect .gitignore patterns when generating migrations', async () => {
    // Create a .gitignore file
    await fs.writeFile(join(repo.path, '.gitignore'), `
# Test ignore patterns
.dev.vars
*.secret
temp/
node_modules/
`, 'utf8');

    // Create files that should be ignored by .gitignore
    await fs.writeFile(join(repo.path, '.dev.vars'), 'SECRET=value');
    await fs.writeFile(join(repo.path, 'config.secret'), 'secret content');
    await fs.mkdir(join(repo.path, 'temp'), { recursive: true });
    await fs.writeFile(join(repo.path, 'temp', 'tempfile.txt'), 'temporary');

    // Create files that should NOT be ignored
    await fs.writeFile(join(repo.path, 'README.md'), '# Project');
    await fs.writeFile(join(repo.path, 'config.js'), 'module.exports = {}');

    // Generate initial migration
    await generateMigration(repo.path, 'initial');

    // Check that migration was created
    const migrationsDir = join(repo.path, 'migrations');
    const migrationFolders = await fs.readdir(migrationsDir);
    expect(migrationFolders).toHaveLength(1);

    const migrationFolder = migrationFolders[0];
    const filesDir = join(migrationsDir, migrationFolder, '__files');

    // Check what files were included in the migration
    const templateFiles = await fs.readdir(filesDir);

    // Files that should be included
    expect(templateFiles).toContain('README.md.template');
    expect(templateFiles).toContain('config.js.template');

    // Files that should NOT be included (ignored by .gitignore)
    expect(templateFiles).not.toContain('.dev.vars.template');
    expect(templateFiles).not.toContain('config.secret.template');
    expect(templateFiles).not.toContain('tempfile.txt.template');

    // Verify the migration file doesn't reference ignored files
    const migrationFile = join(migrationsDir, migrationFolder, 'migrate.ts');
    const migrationContent = await fs.readFile(migrationFile, 'utf8');
    
    expect(migrationContent).toContain('README.md');
    expect(migrationContent).toContain('config.js');
    expect(migrationContent).not.toContain('.dev.vars');
    expect(migrationContent).not.toContain('config.secret');
    expect(migrationContent).not.toContain('tempfile.txt');
  });

  it('should allow .migrateignore to override .gitignore patterns', async () => {
    // Create a .gitignore file that ignores .env files
    await fs.writeFile(join(repo.path, '.gitignore'), `
.env*
*.log
`, 'utf8');

    // Create a .migrateignore file that includes .env.example but still ignores .env
    await fs.writeFile(join(repo.path, '.migrateignore'), `
!.env.example
`, 'utf8');

    // Create files
    await fs.writeFile(join(repo.path, '.env'), 'SECRET=value');
    await fs.writeFile(join(repo.path, '.env.example'), 'SECRET=example');
    await fs.writeFile(join(repo.path, 'app.log'), 'log content');
    await fs.writeFile(join(repo.path, 'README.md'), '# Project');

    // Generate migration
    await generateMigration(repo.path, 'test');

    const migrationsDir = join(repo.path, 'migrations');
    const migrationFolders = await fs.readdir(migrationsDir);
    const migrationFolder = migrationFolders[0];
    const filesDir = join(migrationsDir, migrationFolder, '__files');
    const templateFiles = await fs.readdir(filesDir);

    // Should include .env.example (overridden by .migrateignore)
    expect(templateFiles).toContain('.env.example.template');
    expect(templateFiles).toContain('README.md.template');

    // Should still ignore .env and .log files
    expect(templateFiles).not.toContain('.env.template');
    expect(templateFiles).not.toContain('app.log.template');
  });

  it('should handle missing .gitignore gracefully', async () => {
    // Don't create a .gitignore file
    
    // Create some files
    await fs.writeFile(join(repo.path, 'README.md'), '# Project');
    await fs.writeFile(join(repo.path, 'package.json'), '{}');

    // Generate migration - should work without errors
    await generateMigration(repo.path, 'no-gitignore');

    const migrationsDir = join(repo.path, 'migrations');
    const migrationFolders = await fs.readdir(migrationsDir);
    expect(migrationFolders).toHaveLength(1);

    const migrationFolder = migrationFolders[0];
    const filesDir = join(migrationsDir, migrationFolder, '__files');
    const templateFiles = await fs.readdir(filesDir);

    // Should include the files
    expect(templateFiles).toContain('README.md.template');
    expect(templateFiles).toContain('package.json.template');
  });
});