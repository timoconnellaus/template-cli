import { promises as fs } from 'fs';
import { join, resolve, dirname } from 'path';
import { select, confirm } from '@inquirer/prompts';

export interface DiffChange {
  operation: 'replace' | 'insert' | 'delete';
  startLine: number;
  endLine?: number;        // for replace/delete operations
  afterLine?: number;      // for insert operations
  oldContent?: string;     // content being replaced/deleted
  newContent?: string;     // content being inserted/replacement
}

export interface MigrationEntry {
  type: 'new' | 'delete' | 'modify' | 'moved';
  path?: string;
  oldPath?: string;  // for moved files
  newPath?: string;  // for moved files
  diffs?: DiffChange[];
}

export interface Migration {
  [key: string]: MigrationEntry;
}

export interface MigrationFile {
  migration: Migration;
}

export interface AppliedMigration {
  name: string;
  appliedAt: string;
}

export interface AppliedMigrationsFile {
  version: string;
  template: string;
  appliedMigrations: AppliedMigration[];
}

export async function generateMigration(projectPath: string, name?: string): Promise<void> {
  const migrationsPath = join(projectPath, 'migrations');
  
  // Ensure migrations directory exists
  await fs.mkdir(migrationsPath, { recursive: true });
  
  // Load ignore patterns
  const ignorePatterns = await loadIgnorePatterns(projectPath);
  
  // Get the current state by reconstructing from existing migrations
  const reconstructedState = await reconstructStateFromMigrations(migrationsPath);
  
  // Get the actual current state
  const actualState = await getCurrentState(projectPath, ignorePatterns);
  
  // Calculate differences
  const migration = await calculateDifferences(reconstructedState, actualState);
  
  // Check if there are any changes
  if (Object.keys(migration).length === 0) {
    console.log('✅ No changes detected - no migration generated');
    return;
  }
  
  // Generate migration folder name
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const migrationName = name || 'migration';
  const folderName = `${timestamp}_${migrationName}`;
  
  const migrationFolderPath = join(migrationsPath, folderName);
  const migrationFilePath = join(migrationFolderPath, 'migrate.ts');
  
  // Create migration folder and __files directory
  await fs.mkdir(migrationFolderPath, { recursive: true });
  const filesDir = join(migrationFolderPath, '__files');
  await fs.mkdir(filesDir, { recursive: true });
  
  // Save template files for new files
  for (const [filePath, entry] of Object.entries(migration)) {
    if (entry.type === 'new') {
      const content = actualState[filePath] || '';
      const templatePath = join(filesDir, `${filePath}.template`);
      await fs.mkdir(join(filesDir, filePath, '..'), { recursive: true });
      await fs.writeFile(templatePath, content, 'utf8');
    }
  }
  
  // Write migration file
  await writeMigrationFile(migrationFilePath, migration);
  
  console.log(`✅ Migration '${folderName}' generated successfully`);
  console.log(`📁 Created: ${migrationFolderPath}`);
}

async function reconstructStateFromMigrations(migrationsPath: string): Promise<Record<string, string>> {
  const state: Record<string, string> = {};
  
  try {
    // Get all migration folders sorted by name (timestamp order)
    const entries = await fs.readdir(migrationsPath);
    const migrationFolders = entries
      .filter(entry => entry.includes('_'))
      .sort();
    
    // Apply each migration in order
    for (const folder of migrationFolders) {
      const migrationPath = join(migrationsPath, folder, 'migrate.ts');
      const filesPath = join(migrationsPath, folder, '__files');
      
      try {
        // Read the migration file
        const migrationContent = await fs.readFile(migrationPath, 'utf8');
        const migration = await parseMigrationFile(migrationContent);
        
        // Apply migration to state
        for (const [filePath, entry] of Object.entries(migration)) {
          if (entry.type === 'new') {
            // Load content from template file
            try {
              const templatePath = join(filesPath, `${filePath}.template`);
              const content = await fs.readFile(templatePath, 'utf8');
              state[filePath] = content;
            } catch (error) {
              // If template file doesn't exist, skip
            }
          } else if (entry.type === 'delete') {
            delete state[filePath];
          } else if (entry.type === 'modify' && entry.diffs) {
            // Apply diffs to existing file
            state[filePath] = applyDiffsToContent(state[filePath] || '', entry.diffs);
          } else if (entry.type === 'moved') {
            // Handle file move
            const oldPath = entry.oldPath;
            const newPath = entry.newPath || filePath;
            
            if (oldPath && state[oldPath]) {
              // Move the content from old path to new path
              let content = state[oldPath];
              
              // Apply diffs if the moved file also has changes
              if (entry.diffs && entry.diffs.length > 0) {
                content = applyDiffsToContent(content, entry.diffs);
              }
              
              state[newPath] = content;
              delete state[oldPath];
            }
          }
        }
      } catch (error) {
        // Skip malformed migration files
        console.warn(`⚠️  Skipping malformed migration: ${folder}`);
      }
    }
  } catch (error) {
    // No migrations directory exists yet
  }
  
  return state;
}

async function getCurrentState(projectPath: string, ignorePatterns: string[]): Promise<Record<string, string>> {
  const state: Record<string, string> = {};
  
  async function scanDirectory(dirPath: string, relativePath: string = ''): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        const relativeFilePath = relativePath ? join(relativePath, entry.name) : entry.name;
        
        // Skip if matches ignore patterns
        if (shouldIgnoreFile(relativeFilePath, ignorePatterns)) {
          continue;
        }
        
        if (entry.isDirectory()) {
          await scanDirectory(fullPath, relativeFilePath);
        } else if (entry.isFile()) {
          try {
            const content = await fs.readFile(fullPath, 'utf8');
            state[relativeFilePath] = content;
          } catch (error) {
            // Skip binary files or files that can't be read as text
          }
        }
      }
    } catch (error) {
      // Skip directories that can't be read
    }
  }
  
  await scanDirectory(projectPath);
  return state;
}

async function calculateDifferences(oldState: Record<string, string>, newState: Record<string, string>): Promise<Migration> {
  const migration: Migration = {};
  
  // Find new and modified files
  for (const [filePath, newContent] of Object.entries(newState)) {
    const oldContent = oldState[filePath];
    
    if (oldContent === undefined) {
      // New file
      migration[filePath] = {
        type: 'new',
        path: filePath
      };
    } else if (oldContent !== newContent) {
      // Modified file - calculate line-by-line diffs
      const diffs = calculateLineDiffs(oldContent, newContent);
      if (diffs.length > 0) {
        migration[filePath] = {
          type: 'modify',
          diffs: diffs
        };
      }
    }
  }
  
  // Find deleted files and handle move detection
  const deletedFiles = Object.keys(oldState).filter(filePath => !(filePath in newState));
  const newFiles = Object.keys(newState).filter(filePath => !(filePath in oldState));
  
  
  for (const deletedPath of deletedFiles) {
    // Check if this might be a move by prompting the user
    if (newFiles.length > 0) {
      const isMove = await confirm({
        message: `File '${deletedPath}' was deleted. Was it moved/renamed?`,
        default: false
      });
      
      if (isMove) {
        // Let user select which new file this was moved to
        const moveTarget = await select({
          message: `Which file was '${deletedPath}' moved to?`,
          choices: [
            ...newFiles.map(path => ({ name: path, value: path })),
            { name: '(None - it was actually deleted)', value: null }
          ]
        });
        
        if (moveTarget) {
          // This is a move operation
          const oldContent = oldState[deletedPath];
          const newContent = newState[moveTarget];
          
          // Remove the "new" entry for the target file since it's actually a move
          delete migration[moveTarget];
          
          // Create move entry
          if (oldContent === newContent) {
            // Simple move without changes
            migration[moveTarget] = {
              type: 'moved',
              oldPath: deletedPath,
              newPath: moveTarget
            };
          } else {
            // Move with changes
            const diffs = calculateLineDiffs(oldContent || '', newContent || '');
            migration[moveTarget] = {
              type: 'moved',
              oldPath: deletedPath,
              newPath: moveTarget,
              diffs: diffs
            };
          }
          
          // Remove this file from the newFiles list so it's not offered again
          const targetIndex = newFiles.indexOf(moveTarget);
          if (targetIndex > -1) {
            newFiles.splice(targetIndex, 1);
          }
          
          continue; // Skip adding as delete
        }
      }
    }
    
    // Not a move, so it's a delete
    migration[deletedPath] = {
      type: 'delete',
      path: deletedPath
    };
  }
  
  return migration;
}

function calculateLineDiffs(oldContent: string, newContent: string): DiffChange[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const diffs: DiffChange[] = [];
  
  // Simple line-by-line diff algorithm
  let oldIndex = 0;
  let newIndex = 0;
  
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex >= oldLines.length) {
      // Remaining lines are insertions
      const insertLines = newLines.slice(newIndex);
      if (insertLines.length > 0) {
        diffs.push({
          operation: 'insert',
          startLine: oldLines.length,
          afterLine: oldLines.length,
          newContent: insertLines.join('\n')
        });
      }
      break;
    } else if (newIndex >= newLines.length) {
      // Remaining lines are deletions
      const deleteLines = oldLines.slice(oldIndex);
      if (deleteLines.length > 0) {
        diffs.push({
          operation: 'delete',
          startLine: oldIndex + 1,
          endLine: oldLines.length,
          oldContent: deleteLines.join('\n')
        });
      }
      break;
    } else if (oldLines[oldIndex] === newLines[newIndex]) {
      // Lines are the same, move forward
      oldIndex++;
      newIndex++;
    } else {
      // Lines differ, find the best match
      const oldLine = oldLines[oldIndex];
      const newLine = newLines[newIndex];
      
      // Simple heuristic: if next lines match, this is a replacement
      if (oldIndex + 1 < oldLines.length && newIndex + 1 < newLines.length &&
          oldLines[oldIndex + 1] === newLines[newIndex + 1]) {
        // Single line replacement
        diffs.push({
          operation: 'replace',
          startLine: oldIndex + 1,
          endLine: oldIndex + 1,
          oldContent: oldLine,
          newContent: newLine
        });
        oldIndex++;
        newIndex++;
      } else {
        // For now, treat as replacement of this line
        diffs.push({
          operation: 'replace',
          startLine: oldIndex + 1,
          endLine: oldIndex + 1,
          oldContent: oldLine,
          newContent: newLine
        });
        oldIndex++;
        newIndex++;
      }
    }
  }
  
  return diffs;
}

async function parseMigrationFile(content: string): Promise<Migration> {
  // Extract the migration object from the file
  const match = content.match(/export const migration = \{(.*)\} as const;/s);
  if (!match || !match[1]) {
    throw new Error('Could not parse migration file');
  }
  
  // Use eval to parse the object since it's JSON with proper formatting
  // This is safe because we control the migration file generation
  const migrationContent = `{${match[1]}}`;
  
  try {
    return eval(`(${migrationContent})`);
  } catch (error) {
    throw new Error(`Could not parse migration content: ${error}`);
  }
}

async function writeMigrationFile(filePath: string, migration: Migration): Promise<void> {
  const formatMigrationEntry = (entry: MigrationEntry): string => {
    return JSON.stringify(entry, null, 2).replace(/\n/g, '\n  ');
  };

  const migrationEntries = Object.entries(migration).map(([key, value]) => {
    const formattedValue = formatMigrationEntry(value);
    return `  "${key}": ${formattedValue}`;
  }).join(',\n');

  const migrationContent = `// Migration generated automatically
export const migration = {
${migrationEntries}
} as const;
`;
  
  await fs.writeFile(filePath, migrationContent, 'utf8');
}

async function loadIgnorePatterns(projectPath: string): Promise<string[]> {
  const ignoreFilePath = join(projectPath, '.migrateignore');
  
  try {
    const content = await fs.readFile(ignoreFilePath, 'utf8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')); // Remove empty lines and comments
  } catch (error) {
    // If .migrateignore doesn't exist, return default patterns
    return [
      'migrations/**',
      '.git/**', 
      'node_modules/**',
      '.DS_Store',
      '*.log',
      '.env*',
      '.migrateignore',
      'bun.lock',
      '.claude/**'
    ];
  }
}

function shouldIgnoreFile(filePath: string, ignorePatterns: string[]): boolean {
  // Always ignore these directories and files
  const hardcodedIgnores = [
    'migrations/',
    '.git/',
    'node_modules/',
    '.migrateignore'
  ];
  
  // Check hardcoded ignores first
  for (const pattern of hardcodedIgnores) {
    if (matchesGitignorePattern(filePath, pattern)) {
      return true;
    }
  }
  
  let shouldIgnore = false;
  
  for (const pattern of ignorePatterns) {
    if (pattern.startsWith('!')) {
      // Negation pattern - if it matches, file should NOT be ignored
      const negPattern = pattern.substring(1);
      if (matchesGitignorePattern(filePath, negPattern)) {
        shouldIgnore = false;
      }
    } else {
      // Normal pattern - if it matches, file should be ignored
      if (matchesGitignorePattern(filePath, pattern)) {
        shouldIgnore = true;
      }
    }
  }
  
  return shouldIgnore;
}

function matchesGitignorePattern(filePath: string, pattern: string): boolean {
  // Skip empty patterns or comments
  if (!pattern.trim() || pattern.startsWith('#')) {
    return false;
  }
  
  // Handle negation patterns (starting with !)
  if (pattern.startsWith('!')) {
    return false; // Handle negation in the calling function
  }
  
  // Remove leading slash if present (makes pattern relative to root)
  if (pattern.startsWith('/')) {
    pattern = pattern.slice(1);
  }
  
  // If pattern ends with / it only matches directories
  const onlyDirectories = pattern.endsWith('/');
  if (onlyDirectories) {
    pattern = pattern.slice(0, -1);
  }
  
  // Convert gitignore pattern to regex
  let regexPattern = pattern
    .replace(/\./g, '\\.')           // Escape dots
    .replace(/\*\*/g, '__DOUBLESTAR__') // Temporarily replace ** 
    .replace(/\*/g, '[^/]*')         // * matches anything except /
    .replace(/__DOUBLESTAR__/g, '.*') // ** matches anything including /
    .replace(/\?/g, '.');            // ? matches single character
  
  // Check if pattern matches the full path or any segment
  const patterns = [
    `^${regexPattern}$`,              // Exact match
    `^${regexPattern}/.*$`,           // Directory match
    `.*/${regexPattern}$`,            // Match at any level (basename)
    `.*/${regexPattern}/.*$`          // Directory at any level
  ];
  
  for (const p of patterns) {
    if (new RegExp(p).test(filePath)) {
      // If pattern is directory-only, check if the matched part is actually a directory
      if (onlyDirectories) {
        // For directory patterns, the match should end with / or be the full path
        const exactMatch = new RegExp(`^${regexPattern}$`).test(filePath);
        const dirMatch = new RegExp(`^${regexPattern}/.*$`).test(filePath) || 
                        new RegExp(`.*/${regexPattern}/.*$`).test(filePath);
        return exactMatch || dirMatch;
      }
      return true;
    }
  }
  
  return false;
}


// Legacy function name for backward compatibility during transition
export const generateMigrations = generateMigration;

export async function initializeFromTemplate(templatePath: string, targetPath: string): Promise<void> {
  const resolvedTemplatePath = resolve(templatePath);
  const resolvedTargetPath = resolve(targetPath);
  
  // Validate template path exists
  try {
    const templateStat = await fs.stat(resolvedTemplatePath);
    if (!templateStat.isDirectory()) {
      throw new Error(`Template path is not a directory: ${resolvedTemplatePath}`);
    }
  } catch (error) {
    throw new Error(`Template directory does not exist: ${resolvedTemplatePath}`);
  }
  
  // Check if template has migrations
  const migrationsPath = join(resolvedTemplatePath, 'migrations');
  let hasMigrations = false;
  try {
    const migrationsStat = await fs.stat(migrationsPath);
    hasMigrations = migrationsStat.isDirectory();
  } catch (error) {
    // No migrations directory, that's ok
  }
  
  // Validate target path - must not exist or be empty
  let targetExists = false;
  try {
    const targetStat = await fs.stat(resolvedTargetPath);
    if (targetStat.isDirectory()) {
      const entries = await fs.readdir(resolvedTargetPath);
      if (entries.length > 0) {
        throw new Error(`Target directory is not empty: ${resolvedTargetPath}`);
      }
      targetExists = true;
    } else {
      throw new Error(`Target path exists but is not a directory: ${resolvedTargetPath}`);
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    // Target doesn't exist, we'll create it
  }
  
  // Ask for confirmation
  const templateName = resolvedTemplatePath.split('/').pop() || 'template';
  const shouldProceed = await confirm({
    message: `Initialize project from template "${templateName}" into "${resolvedTargetPath}"?`,
    default: true
  });
  
  if (!shouldProceed) {
    console.log('❌ Initialization cancelled');
    return;
  }
  
  // Create target directory if it doesn't exist
  if (!targetExists) {
    await fs.mkdir(resolvedTargetPath, { recursive: true });
  }
  
  console.log('🚀 Initializing project...');
  
  if (hasMigrations) {
    // Apply all migrations in order
    await applyAllMigrations(resolvedTemplatePath, resolvedTargetPath);
  } else {
    // Just copy the template as-is (excluding migrations directory and other meta files)
    await copyTemplate(resolvedTemplatePath, resolvedTargetPath);
    
    // Create initial applied-migrations.json
    const appliedMigrationsFile: AppliedMigrationsFile = {
      version: '1.0.0',
      template: resolvedTemplatePath,
      appliedMigrations: []
    };
    
    await fs.writeFile(
      join(resolvedTargetPath, 'applied-migrations.json'),
      JSON.stringify(appliedMigrationsFile, null, 2),
      'utf8'
    );
  }
  
  console.log(`✅ Project initialized successfully in ${resolvedTargetPath}`);
}

async function applyAllMigrations(templatePath: string, targetPath: string): Promise<void> {
  const migrationsPath = join(templatePath, 'migrations');
  const appliedMigrations: AppliedMigration[] = [];
  
  // Get all migration folders sorted by timestamp
  const entries = await fs.readdir(migrationsPath, { withFileTypes: true });
  const migrationFolders = entries
    .filter(entry => entry.isDirectory() && entry.name.match(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_/))
    .map(entry => entry.name)
    .sort();
  
  console.log(`📦 Applying ${migrationFolders.length} migrations...`);
  
  for (const migrationFolder of migrationFolders) {
    console.log(`   Applying ${migrationFolder}...`);
    await applyMigration(templatePath, targetPath, migrationFolder);
    
    appliedMigrations.push({
      name: migrationFolder,
      appliedAt: new Date().toISOString()
    });
  }
  
  // Create applied-migrations.json
  const appliedMigrationsFile: AppliedMigrationsFile = {
    version: '1.0.0',
    template: templatePath,
    appliedMigrations
  };
  
  await fs.writeFile(
    join(targetPath, 'applied-migrations.json'),
    JSON.stringify(appliedMigrationsFile, null, 2),
    'utf8'
  );
}

async function applyMigration(templatePath: string, targetPath: string, migrationFolder: string): Promise<void> {
  const migrationPath = join(templatePath, 'migrations', migrationFolder);
  const migrationFile = await readMigrationFromPath(migrationPath);
  
  for (const [filePath, entry] of Object.entries(migrationFile.migration)) {
    const targetFilePath = join(targetPath, filePath);
    
    switch (entry.type) {
      case 'new':
        // Copy file from __files directory
        const templateFilePath = join(migrationPath, '__files', `${filePath}.template`);
        await ensureDirectoryExists(dirname(targetFilePath));
        await fs.copyFile(templateFilePath, targetFilePath);
        break;
        
      case 'modify':
        // Apply diffs to existing file
        if (entry.diffs) {
          const currentContent = await fs.readFile(targetFilePath, 'utf8');
          const newContent = applyDiffsToContent(currentContent, entry.diffs);
          await fs.writeFile(targetFilePath, newContent, 'utf8');
        }
        break;
        
      case 'delete':
        // Remove file
        try {
          await fs.unlink(targetFilePath);
        } catch (error) {
          // File might not exist, that's ok
        }
        break;
        
      case 'moved':
        // Handle file moves
        if (entry.oldPath && entry.newPath) {
          const oldFilePath = join(targetPath, entry.oldPath);
          const newFilePath = join(targetPath, entry.newPath);
          
          try {
            await ensureDirectoryExists(dirname(newFilePath));
            await fs.rename(oldFilePath, newFilePath);
            
            // Apply diffs if there are content changes
            if (entry.diffs) {
              const currentContent = await fs.readFile(newFilePath, 'utf8');
              const newContent = applyDiffsToContent(currentContent, entry.diffs);
              await fs.writeFile(newFilePath, newContent, 'utf8');
            }
          } catch (error) {
            // File might not exist for move, that's ok
          }
        }
        break;
    }
  }
}

async function copyTemplate(templatePath: string, targetPath: string): Promise<void> {
  const entries = await fs.readdir(templatePath, { withFileTypes: true });
  
  for (const entry of entries) {
    // Skip migrations directory and other meta files
    if (entry.name === 'migrations' || entry.name === 'applied-migrations.json' || entry.name === '.git') {
      continue;
    }
    
    const sourcePath = join(templatePath, entry.name);
    const destPath = join(targetPath, entry.name);
    
    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyTemplate(sourcePath, destPath);
    } else {
      await fs.copyFile(sourcePath, destPath);
    }
  }
}

async function readMigrationFromPath(migrationPath: string): Promise<MigrationFile> {
  const migrationFilePath = join(migrationPath, 'migrate.ts');
  const content = await fs.readFile(migrationFilePath, 'utf8');
  
  // Extract the migration object from the file
  const match = content.match(/export const migration = \{(.*)\} as const;/s);
  if (!match || !match[1]) {
    throw new Error('Could not parse migration file');
  }
  
  // Use eval to parse the object since it's our own generated format
  const migrationContent = `{${match[1]}}`;
  
  try {
    const migration = eval(`(${migrationContent})`);
    return { migration };
  } catch (error) {
    throw new Error(`Could not parse migration content: ${error}`);
  }
}

function applyDiffsToContent(content: string, diffs: DiffChange[]): string {
  const lines = content.split('\n');
  
  // Apply diffs in reverse order to maintain line numbers
  const sortedDiffs = [...diffs].sort((a, b) => b.startLine - a.startLine);
  
  for (const diff of sortedDiffs) {
    switch (diff.operation) {
      case 'replace':
        if (diff.endLine) {
          lines.splice(diff.startLine - 1, diff.endLine - diff.startLine + 1, diff.newContent || '');
        }
        break;
        
      case 'insert':
        if (diff.afterLine !== undefined) {
          lines.splice(diff.afterLine, 0, diff.newContent || '');
        }
        break;
        
      case 'delete':
        if (diff.endLine) {
          lines.splice(diff.startLine - 1, diff.endLine - diff.startLine + 1);
        }
        break;
    }
  }
  
  return lines.join('\n');
}

async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    // Directory might already exist, that's ok
  }
}

// Export internal functions for testing
export { matchesGitignorePattern, shouldIgnoreFile, calculateLineDiffs };