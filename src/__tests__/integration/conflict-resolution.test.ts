import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { writeFile, mkdir, readFile, unlink } from 'fs/promises';
import { applyMigration } from '../../utils/template-utils.js';
import { createTestRepo } from '../test-helpers.js';
import * as readline from 'readline';

// Mock readline for conflict resolution
vi.mock('readline', () => ({
  createInterface: vi.fn(),
}));

describe('Conflict Resolution Integration', () => {
  let templateRepo: { path: string; cleanup: () => Promise<void> };
  let targetRepo: { path: string; cleanup: () => Promise<void> };
  let mockRl: any;
  let mockQuestion: any;

  beforeEach(async () => {
    templateRepo = await createTestRepo();
    targetRepo = await createTestRepo();
    
    // Setup readline mock
    mockQuestion = vi.fn();
    mockRl = {
      question: mockQuestion,
      close: vi.fn(),
    };
    vi.mocked(readline.createInterface).mockReturnValue(mockRl);
  });

  afterEach(async () => {
    await templateRepo.cleanup();
    await targetRepo.cleanup();
    vi.restoreAllMocks();
  });

  it('should handle conflict when diff tries to modify line that user already changed', async () => {
    // 1. Create initial file in target (simulates file from previous migration)
    const initialContent = `line 1
original line 2
line 3`;
    await writeFile(join(targetRepo.path, 'config.txt'), initialContent);

    // 2. User modifies line 2 AND adds extra content (simulates local changes after migration)
    // This will cause the diff to fail because the context doesn't match
    const userModifiedContent = `line 1
user completely changed line 2 with different content
line 3
extra user line that breaks the diff context`;
    await writeFile(join(targetRepo.path, 'config.txt'), userModifiedContent);

    // 3. Create migration that tries to modify the same line 2
    const migrationsDir = join(templateRepo.path, 'migrations');
    await mkdir(migrationsDir, { recursive: true });
    const migrationDir = join(migrationsDir, 'test-conflict-migration');
    await mkdir(migrationDir, { recursive: true });
    
    const filesDir = join(migrationDir, '__files');
    await mkdir(filesDir, { recursive: true });

    // Create a diff that expects different content than what the user has
    const conflictingDiff = `--- config.txt
+++ config.txt
@@ -1,3 +1,3 @@
 line 1
-original line 2
+template modified line 2
 line 3`;
    await writeFile(join(filesDir, 'config.txt.diff'), conflictingDiff);

    // Create migration file
    const migrationContent = `// Migration generated automatically
export const migration = {
  'config.txt': {
    type: 'modify',
    diffFile: 'config.txt.diff'
  }
} as const;`;
    await writeFile(join(migrationDir, 'migrate.ts'), migrationContent);

    // 4. Test "keep my version" choice
    mockQuestion.mockImplementation((question: string, callback: (answer: string) => void) => {
      callback('1'); // Choose to keep user's version
    });

    await applyMigration(templateRepo.path, targetRepo.path, 'test-conflict-migration');

    // Verify user's content is preserved
    const resultContent = await readFile(join(targetRepo.path, 'config.txt'), 'utf8');
    expect(resultContent).toBe(userModifiedContent);
    expect(mockRl.close).toHaveBeenCalled();
  });

  it('should apply template version when user chooses template in conflict', async () => {
    // 1. Create initial file in target
    const initialContent = `line 1
original line 2
line 3`;
    await writeFile(join(targetRepo.path, 'config.txt'), initialContent);

    // 2. User modifies content in a way that breaks diff context
    const userModifiedContent = `line 1
user completely rewrote this line with different content
line 3
user added this line which breaks the expected context`;
    await writeFile(join(targetRepo.path, 'config.txt'), userModifiedContent);

    // 3. Create migration that tries to modify the same line 2
    const migrationsDir = join(templateRepo.path, 'migrations');
    await mkdir(migrationsDir, { recursive: true });
    const migrationDir = join(migrationsDir, 'test-conflict-migration');
    await mkdir(migrationDir, { recursive: true });
    
    const filesDir = join(migrationDir, '__files');
    await mkdir(filesDir, { recursive: true });

    // This diff expects "original line 2" but the file now has different content
    const conflictingDiff = `--- config.txt
+++ config.txt
@@ -1,3 +1,3 @@
 line 1
-original line 2
+template modified line 2
 line 3`;
    await writeFile(join(filesDir, 'config.txt.diff'), conflictingDiff);

    const migrationContent = `// Migration generated automatically
export const migration = {
  'config.txt': {
    type: 'modify',
    diffFile: 'config.txt.diff'
  }
} as const;`;
    await writeFile(join(migrationDir, 'migrate.ts'), migrationContent);

    // 4. Test "use template" choice
    mockQuestion.mockImplementation((question: string, callback: (answer: string) => void) => {
      callback('2'); // Choose to use template version
    });

    await applyMigration(templateRepo.path, targetRepo.path, 'test-conflict-migration');

    // Verify template changes are applied
    const resultContent = await readFile(join(targetRepo.path, 'config.txt'), 'utf8');
    const expectedContent = `line 1
template modified line 2
line 3`;
    expect(resultContent).toBe(expectedContent);
    expect(mockRl.close).toHaveBeenCalled();
  });

  it('should handle complex conflict with multiple changes', async () => {
    // 1. Create initial file
    const initialContent = `# Config File
setting1=original
setting2=value2
setting3=value3
# End of config`;
    await writeFile(join(targetRepo.path, 'app.config'), initialContent);

    // 2. User makes major structural changes that break diff context
    const userModifiedContent = `# User's Completely Restructured Config File
[section1]
setting1=user_changed
setting2=value2

[section2]  
setting3=user_added_new_value
setting4=new_user_setting

# User added comments and restructured everything
# End of user config`;
    await writeFile(join(targetRepo.path, 'app.config'), userModifiedContent);

    // 3. Create migration that conflicts with user changes
    const migrationsDir = join(templateRepo.path, 'migrations');
    await mkdir(migrationsDir, { recursive: true });
    const migrationDir = join(migrationsDir, 'complex-conflict-migration');
    await mkdir(migrationDir, { recursive: true });
    
    const filesDir = join(migrationDir, '__files');
    await mkdir(filesDir, { recursive: true });

    // Diff that tries to change setting1 and setting3 differently
    const complexDiff = `--- app.config
+++ app.config
@@ -1,5 +1,6 @@
 # Config File
-setting1=original
+setting1=template_updated
 setting2=value2
-setting3=value3
+setting3=template_new_value
+setting4=template_setting
 # End of config`;
    await writeFile(join(filesDir, 'app.config.diff'), complexDiff);

    const migrationContent = `// Migration generated automatically
export const migration = {
  'app.config': {
    type: 'modify',
    diffFile: 'app.config.diff'
  }
} as const;`;
    await writeFile(join(migrationDir, 'migrate.ts'), migrationContent);

    // 4. Test keeping user version in complex conflict
    mockQuestion.mockImplementation((question: string, callback: (answer: string) => void) => {
      callback('1'); // Keep user's version
    });

    await applyMigration(templateRepo.path, targetRepo.path, 'complex-conflict-migration');

    // Verify user's complex changes are preserved
    const resultContent = await readFile(join(targetRepo.path, 'app.config'), 'utf8');
    expect(resultContent).toBe(userModifiedContent);
    expect(mockRl.close).toHaveBeenCalled();
  });

  it('should handle conflict in file modification with existing changes', async () => {
    // 1. Create initial file 
    const initialContent = `function calculate() {
  return 42;
}`;
    await writeFile(join(targetRepo.path, 'utils.js'), initialContent);

    // 2. User modifies the file
    const userModifiedContent = `// User added comments and changed logic
function calculate() {
  // User's new implementation
  return Math.random() * 100;
}

// User added this new function
function helper() {
  return 'user added this';
}`;
    await writeFile(join(targetRepo.path, 'utils.js'), userModifiedContent);

    // 3. Create migration that tries to modify the same file differently
    const migrationsDir = join(templateRepo.path, 'migrations');
    await mkdir(migrationsDir, { recursive: true });
    const migrationDir = join(migrationsDir, 'modify-conflict-migration');
    await mkdir(migrationDir, { recursive: true });
    
    const filesDir = join(migrationDir, '__files');
    await mkdir(filesDir, { recursive: true });

    // Diff that expects the original function but user has changed it
    const conflictingDiff = `--- utils.js
+++ utils.js
@@ -1,3 +1,4 @@
 function calculate() {
-  return 42;
+  return 42 * 2; // Template modification
+  // Template added comment
 }`;
    await writeFile(join(filesDir, 'utils.js.diff'), conflictingDiff);

    const migrationContent = `// Migration generated automatically
export const migration = {
  'utils.js': {
    type: 'modify',
    diffFile: 'utils.js.diff'
  }
} as const;`;
    await writeFile(join(migrationDir, 'migrate.ts'), migrationContent);

    // 4. Test template choice for conflict
    mockQuestion.mockImplementation((question: string, callback: (answer: string) => void) => {
      callback('2'); // Use template version
    });

    await applyMigration(templateRepo.path, targetRepo.path, 'modify-conflict-migration');

    // Verify template changes are applied
    const resultContent = await readFile(join(targetRepo.path, 'utils.js'), 'utf8');
    expect(resultContent).toContain('return 42 * 2');
    expect(resultContent).toContain('Template added comment');
    expect(mockRl.close).toHaveBeenCalled();
  });
});