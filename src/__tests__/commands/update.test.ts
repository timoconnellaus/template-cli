import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { updateFromTemplate } from '../../commands/update.js';
import { generateMigration } from '../../commands/generate.js';
import { createTestRepo } from '../test-helpers.js';

// Mock @inquirer/prompts for conflict resolution
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
}));

// Mock child_process for Claude CLI calls
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('update command', () => {
  let templateRepo: { path: string; cleanup: () => Promise<void> };
  let projectRepo: { path: string; cleanup: () => Promise<void> };
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockSelect: any;

  beforeEach(async () => {
    templateRepo = await createTestRepo();
    projectRepo = await createTestRepo();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    // Setup select prompt mock
    mockSelect = vi.fn();
    const inquirer = await import('@inquirer/prompts');
    vi.mocked(inquirer.select).mockImplementation(mockSelect);
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

  it('should handle conflict resolution when user keeps their version', async () => {
    // 1. Create initial state in template and generate migration
    await writeFile(join(templateRepo.path, 'config.txt'), 'line 1\noriginal line 2\nline 3');
    await generateMigration(templateRepo.path, 'initial');

    // 2. Modify template to create a migration that will conflict
    await writeFile(join(templateRepo.path, 'config.txt'), 'line 1\ntemplate updated line 2\nline 3');
    await generateMigration(templateRepo.path, 'update-config');

    // 3. Set up project with the initial state
    await writeFile(join(projectRepo.path, 'config.txt'), 'line 1\noriginal line 2\nline 3');
    
    // Apply first migration manually to set up project state
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

    // 4. User modifies the file locally (creates conflict by breaking diff context)
    await writeFile(join(projectRepo.path, 'config.txt'), 'line 1\nuser completely rewrote line 2 differently\nline 3\nextra user content that breaks context');

    // 5. Mock user choosing to keep their version
    mockSelect.mockResolvedValue('keep');

    // 6. Run update
    await updateFromTemplate(projectRepo.path);

    // 7. Verify conflict was resolved and user's content was preserved
    const finalContent = await readFile(join(projectRepo.path, 'config.txt'), 'utf8');
    expect(finalContent).toBe('line 1\nuser completely rewrote line 2 differently\nline 3\nextra user content that breaks context');
    
    // Verify conflict resolution was triggered
    expect(mockSelect).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('📝 Kept your version of config.txt')
    );
    
    // Verify migration was still marked as applied
    const updatedAppliedMigrations = JSON.parse(
      await readFile(join(projectRepo.path, 'applied-migrations.json'), 'utf8')
    );
    expect(updatedAppliedMigrations.appliedMigrations).toHaveLength(2);
  });

  it('should handle conflict resolution when user chooses template version', async () => {
    // 1. Create initial state in template and generate migration
    await writeFile(join(templateRepo.path, 'package.json'), '{"name": "test", "version": "1.0.0"}');
    await generateMigration(templateRepo.path, 'initial');

    // 2. Modify template to create a migration that will conflict
    await writeFile(join(templateRepo.path, 'package.json'), '{"name": "test", "version": "2.0.0", "description": "Updated"}');
    await generateMigration(templateRepo.path, 'update-package');

    // 3. Set up project with the initial state
    await writeFile(join(projectRepo.path, 'package.json'), '{"name": "test", "version": "1.0.0"}');
    
    // Apply first migration manually to set up project state
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

    // 4. User modifies the file in a way that breaks diff context
    await writeFile(join(projectRepo.path, 'package.json'), '{\n  "name": "test",\n  "version": "1.5.0",\n  "author": "User Added",\n  "userField": "breaks context"\n}');

    // 5. Mock user choosing template version
    mockSelect.mockResolvedValue('template');

    // 6. Run update
    await updateFromTemplate(projectRepo.path);

    // 7. Verify template content was applied
    const finalContent = await readFile(join(projectRepo.path, 'package.json'), 'utf8');
    expect(finalContent).toContain('"version": "2.0.0"');
    expect(finalContent).toContain('"description": "Updated"');
    
    // Verify conflict resolution was triggered
    expect(mockSelect).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('📝 Applied template version of package.json')
    );
  });

  it('should handle multiple conflicts in a single update', async () => {
    // This test verifies that when multiple files have conflicts in a single migration,
    // the user can resolve each conflict individually
    
    // 1. Create simple initial state
    await writeFile(join(templateRepo.path, 'config.txt'), 'line1\nline2');
    await generateMigration(templateRepo.path, 'initial');

    // 2. Update template to create a migration with multiple file changes
    await writeFile(join(templateRepo.path, 'config.txt'), 'line1\ntemplate_updated_line2');
    await writeFile(join(templateRepo.path, 'app.js'), 'console.log("new file");');
    await generateMigration(templateRepo.path, 'update-files');

    // 3. Set up project with first migration applied
    await writeFile(join(projectRepo.path, 'config.txt'), 'line1\nline2');
    
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

    // 4. User modifies config.txt in a way that breaks the diff
    await writeFile(join(projectRepo.path, 'config.txt'), 'line1\nuser_completely_changed_line2\nextra_user_content');

    // 5. Mock user choice to keep their version for the conflict
    mockSelect.mockResolvedValue('keep');

    // 6. Run update
    await updateFromTemplate(projectRepo.path);

    // 7. Verify conflict was resolved and new file was still added
    const configContent = await readFile(join(projectRepo.path, 'config.txt'), 'utf8');
    expect(configContent).toContain('user_completely_changed_line2');
    expect(configContent).toContain('extra_user_content');
    
    // New file should still be added (no conflict)
    const appContent = await readFile(join(projectRepo.path, 'app.js'), 'utf8');
    expect(appContent).toBe('console.log("new file");');
    
    // Verify conflict resolution was triggered once
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('📝 Kept your version of config.txt')
    );
  });

  it('should continue applying migrations after resolving conflicts', async () => {
    // 1. Create template with multiple migrations
    await writeFile(join(templateRepo.path, 'file1.txt'), 'original content');
    await generateMigration(templateRepo.path, 'add-file1');

    await writeFile(join(templateRepo.path, 'file2.txt'), 'file2 content');
    await generateMigration(templateRepo.path, 'add-file2');

    // Modify file1 to create conflict in third migration
    await writeFile(join(templateRepo.path, 'file1.txt'), 'updated content');
    await generateMigration(templateRepo.path, 'update-file1');

    // Add file3 (should apply without conflict)
    await writeFile(join(templateRepo.path, 'file3.txt'), 'file3 content');
    await generateMigration(templateRepo.path, 'add-file3');

    // 2. Set up project with first migration applied
    await writeFile(join(projectRepo.path, 'file1.txt'), 'original content');
    
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

    // 3. User modifies file1 to create conflict by changing structure
    await writeFile(join(projectRepo.path, 'file1.txt'), 'user completely restructured content with extra lines\nand more changes that break diff context');

    // 4. Mock user choosing to keep their version for the conflict
    mockSelect.mockResolvedValue('keep');

    // 5. Run update
    await updateFromTemplate(projectRepo.path);

    // 6. Verify all migrations were applied
    const updatedAppliedMigrations = JSON.parse(
      await readFile(join(projectRepo.path, 'applied-migrations.json'), 'utf8')
    );
    expect(updatedAppliedMigrations.appliedMigrations).toHaveLength(4);

    // 7. Verify files exist and conflict was resolved correctly
    const file1Content = await readFile(join(projectRepo.path, 'file1.txt'), 'utf8');
    expect(file1Content).toBe('user completely restructured content with extra lines\nand more changes that break diff context'); // User's version kept

    const file2Content = await readFile(join(projectRepo.path, 'file2.txt'), 'utf8');
    expect(file2Content).toBe('file2 content'); // Applied without conflict

    const file3Content = await readFile(join(projectRepo.path, 'file3.txt'), 'utf8');
    expect(file3Content).toBe('file3 content'); // Applied without conflict

    // Verify success message
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('🎉 Successfully applied 3 migration(s).')
    );
  });

  it('should calculate user diff correctly using migration history', async () => {
    // This test directly verifies that the user diff calculation works properly
    // by setting up a realistic scenario with migration history
    
    // 1. Create initial template state
    await writeFile(join(templateRepo.path, 'config.js'), 'export const config = {\n  version: "1.0.0",\n  debug: false\n};');
    await generateMigration(templateRepo.path, 'initial');

    // 2. Template evolution: add new config option
    await writeFile(join(templateRepo.path, 'config.js'), 'export const config = {\n  version: "1.0.0",\n  debug: false,\n  timeout: 5000\n};');
    await generateMigration(templateRepo.path, 'add-timeout');

    // 3. Set up project with baseline state (first migration applied)
    await writeFile(join(projectRepo.path, 'config.js'), 'export const config = {\n  version: "1.0.0",\n  debug: false\n};');
    
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

    // 4. User makes their own changes to the file
    const userModifiedContent = 'export const config = {\n  version: "2.0.0",  // User updated version\n  debug: true,       // User enabled debug\n  apiKey: "secret"   // User added API key\n};';
    await writeFile(join(projectRepo.path, 'config.js'), userModifiedContent);

    // 5. Test the user diff calculation directly
    const conflictUtils = await import('../../utils/conflict-utils.js');
    const userDiff = await conflictUtils.calculateUserDiff(
      'config.js',
      userModifiedContent,
      templateRepo.path
    );

    // 6. Verify the user diff shows what the user changed from the baseline
    expect(userDiff).not.toBeNull();
    expect(userDiff).toContain('--- config.js.baseline');
    expect(userDiff).toContain('+++ config.js');
    expect(userDiff).toContain('-  version: "1.0.0",');
    expect(userDiff).toContain('+  version: "2.0.0",  // User updated version');
    expect(userDiff).toContain('-  debug: false');
    expect(userDiff).toContain('+  debug: true,       // User enabled debug');
    expect(userDiff).toContain('+  apiKey: "secret"   // User added API key');

    // 7. Also test that when user content matches baseline, no diff is returned
    const baselineContent = 'export const config = {\n  version: "1.0.0",\n  debug: false\n};';
    const noDiff = await conflictUtils.calculateUserDiff(
      'config.js',
      baselineContent,
      templateRepo.path
    );
    expect(noDiff).toBeNull();
  });

  it('should handle user diff calculation for newly created files', async () => {
    // Test case where user creates a file that doesn't exist in template baseline
    
    // 1. Create minimal template
    await writeFile(join(templateRepo.path, 'README.md'), '# Template');
    await generateMigration(templateRepo.path, 'initial');

    // 2. Template adds a config file
    await writeFile(join(templateRepo.path, 'config.json'), '{"template": true}');
    await generateMigration(templateRepo.path, 'add-config');

    // 3. Set up project with first migration applied
    await writeFile(join(projectRepo.path, 'README.md'), '# Template');
    
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

    // 4. User creates a different file (truly new, not in template)
    await writeFile(join(projectRepo.path, 'user-config.json'), '{"user": true, "customized": "yes"}');

    // 5. Test the user diff calculation directly for a truly new file
    const conflictUtils = await import('../../utils/conflict-utils.js');
    const userDiff = await conflictUtils.calculateUserDiff(
      'user-config.json',
      '{"user": true, "customized": "yes"}',
      templateRepo.path
    );

    // 6. Verify user diff shows file as newly created by user
    expect(userDiff).not.toBeNull();
    expect(userDiff).toContain('--- /dev/null');
    expect(userDiff).toContain('+++ user-config.json');
    expect(userDiff).toContain('+{"user": true, "customized": "yes"}');
  });

  it('should handle user diff calculation when user removes lines', async () => {
    // Test case where user removes content from the baseline
    
    // 1. Create template with multi-line file
    await writeFile(join(templateRepo.path, 'script.sh'), '#!/bin/bash\necho "line 1"\necho "line 2"\necho "line 3"\necho "line 4"');
    await generateMigration(templateRepo.path, 'initial');

    // 2. Template modifies the script (adds a line)
    await writeFile(join(templateRepo.path, 'script.sh'), '#!/bin/bash\necho "line 1"\necho "line 2"\necho "line 3"\necho "line 4"\necho "template added"');
    await generateMigration(templateRepo.path, 'update-script');

    // 3. Set up project with baseline state
    await writeFile(join(projectRepo.path, 'script.sh'), '#!/bin/bash\necho "line 1"\necho "line 2"\necho "line 3"\necho "line 4"');
    
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

    // 4. User removes some lines and adds their own
    await writeFile(join(projectRepo.path, 'script.sh'), '#!/bin/bash\necho "line 1"\n# User removed line 2 and 3\necho "line 4"\necho "user custom line"');

    // 5. Test the user diff calculation
    const conflictUtils = await import('../../utils/conflict-utils.js');
    const userDiff = await conflictUtils.calculateUserDiff(
      'script.sh',
      '#!/bin/bash\necho "line 1"\n# User removed line 2 and 3\necho "line 4"\necho "user custom line"',
      templateRepo.path
    );

    // 6. Verify user diff shows the removals and additions
    expect(userDiff).not.toBeNull();
    expect(userDiff).toContain('--- script.sh.baseline');
    expect(userDiff).toContain('+++ script.sh');
    expect(userDiff).toContain('-echo "line 2"');
    expect(userDiff).toContain('-echo "line 3"');
    expect(userDiff).toContain('+# User removed line 2 and 3');
    expect(userDiff).toContain('+echo "user custom line"');
  });
});