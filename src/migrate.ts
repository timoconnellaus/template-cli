import { simpleGit, type SimpleGit } from 'simple-git';
import { promises as fs } from 'fs';
import { join } from 'path';

export interface Migration {
  [filePath: string]: string | string[] | { deleted: true };
}

export interface MigrationFile {
  migration: Migration;
}

export async function generateMigrations(projectPath: string): Promise<void> {
  const git: SimpleGit = simpleGit(projectPath);
  const migrationsPath = join(projectPath, 'migrations');
  
  // Ensure migrations directory exists
  await fs.mkdir(migrationsPath, { recursive: true });
  
  // Load ignore patterns
  const ignorePatterns = await loadIgnorePatterns(projectPath);
  
  // Get all commits
  const log = await git.log();
  const commits = log.all;
  
  if (commits.length === 0) {
    throw new Error('No commits found in repository');
  }
  
  // Clean up old "latest" folders first
  await cleanupOldLatestFolders(migrationsPath, [...commits]);
  
  // Process each commit that doesn't have a migration yet
  for (let i = commits.length - 1; i >= 0; i--) {
    const commit = commits[i];
    const commitNumber = String(commits.length - i).padStart(2, '0');
    const isLatest = i === 0;
    
    const folderName = isLatest 
      ? `${commitNumber}_latest`
      : `${commitNumber}_${commit?.hash?.substring(0, 8) ?? 'unknown'}`;
    
    const migrationFolderPath = join(migrationsPath, folderName);
    const migrationFilePath = join(migrationFolderPath, 'migrate.ts');
    
    // Skip if migration already exists
    if (await fileExists(migrationFilePath)) {
      continue;
    }
    
    // Generate migration for this commit
    const migration = await generateMigrationForCommit(git, commit, i === commits.length - 1, ignorePatterns);
    
    // Create migration folder and file
    await fs.mkdir(migrationFolderPath, { recursive: true });
    await writeMigrationFile(migrationFilePath, migration);
  }
}

async function generateMigrationForCommit(
  git: SimpleGit,
  commit: any,
  isFirstCommit: boolean,
  ignorePatterns: string[]
): Promise<Migration> {
  const migration: Migration = {};
  
  if (isFirstCommit) {
    // For the first commit, all files are new
    const files = await git.show([commit.hash, '--name-only', '--pretty=format:']);
    const fileList = files.split('\n').filter(f => f.trim() !== '');
    
    for (const file of fileList) {
      // Skip if file matches ignore patterns
      if (shouldIgnoreFile(file, ignorePatterns)) {
        continue;
      }
      
      try {
        const content = await git.show([`${commit.hash}:${file}`]);
        migration[file] = content;
      } catch (error) {
        // File might be deleted or binary, skip
      }
    }
  } else {
    // For other commits, get the diff
    const diff = await git.show([
      commit.hash,
      '--name-status',
      '--pretty=format:'
    ]);
    
    const lines = diff.split('\n').filter(l => l.trim() !== '');
    
    for (const line of lines) {
      const [status, ...fileParts] = line.split('\t');
      const file = fileParts.join('\t');
      
      // Skip if file matches ignore patterns
      if (shouldIgnoreFile(file, ignorePatterns)) {
        continue;
      }
      
      if (status?.startsWith('D')) {
        // File deleted
        migration[file] = { deleted: true };
      } else if (status?.startsWith('A')) {
        // File added
        try {
          const content = await git.show([`${commit.hash}:${file}`]);
          migration[file] = content;
        } catch (error) {
          // Skip if we can't read the file
        }
      } else if (status?.startsWith('M') || status?.startsWith('R')) {
        // File modified or renamed
        try {
          const diffContent = await git.show([
            commit.hash,
            '--',
            file
          ]);
          
          // Extract the actual diff lines (skip the header)
          const diffLines = diffContent.split('\n');
          const relevantLines = diffLines.filter(line => 
            line.startsWith('+') || line.startsWith('-')
          );
          
          migration[file] = relevantLines;
        } catch (error) {
          // Skip if we can't get the diff
        }
      }
    }
  }
  
  return migration;
}

async function writeMigrationFile(filePath: string, migration: Migration): Promise<void> {
  const formatValue = (value: string | string[] | { deleted: true }): string => {
    if (typeof value === 'string') {
      // Use template literal for string content
      return '`' + value.replace(/`/g, '\\`').replace(/\${/g, '\\${') + '`';
    } else if (Array.isArray(value)) {
      // Format diff lines as array
      return '[' + value.map(line => 
        '`' + line.replace(/`/g, '\\`').replace(/\${/g, '\\${') + '`'
      ).join(',\n    ') + ']';
    } else {
      // Handle deleted files
      return JSON.stringify(value);
    }
  };

  const migrationEntries = Object.entries(migration).map(([key, value]) => {
    const formattedValue = formatValue(value);
    return `  "${key}": ${formattedValue}`;
  }).join(',\n');

  const migrationContent = `// Migration generated automatically
export const migration = {
${migrationEntries}
} as const;
`;
  
  await fs.writeFile(filePath, migrationContent, 'utf8');
}

async function cleanupOldLatestFolders(migrationsPath: string, commits: any[]): Promise<void> {
  try {
    const entries = await fs.readdir(migrationsPath);
    const latestFolders = entries.filter(entry => entry.endsWith('_latest'));
    
    // The current latest should be the last commit (index 0)
    const expectedLatestNumber = String(commits.length).padStart(2, '0');
    const expectedLatestFolder = `${expectedLatestNumber}_latest`;
    
    for (const folder of latestFolders) {
      if (folder !== expectedLatestFolder) {
        // This is an old latest folder that needs to be renamed
        const oldLatestPath = join(migrationsPath, folder);
        
        // Extract the migration number to find the corresponding commit
        const parts = folder.split('_');
        if (parts.length >= 2 && parts[0]) {
          const migrationNumber = parseInt(parts[0]);
          const commitIndex = commits.length - migrationNumber;
          const commit = commits[commitIndex];
          
          if (commit?.hash) {
            const newName = folder.replace('_latest', `_${commit.hash.substring(0, 8)}`);
            const newPath = join(migrationsPath, newName);
            
            await fs.rename(oldLatestPath, newPath);
          }
        }
      }
    }
  } catch (error) {
    // Ignore errors in cleanup
  }
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
      '.env*'
    ];
  }
}

function shouldIgnoreFile(filePath: string, ignorePatterns: string[]): boolean {
  for (const pattern of ignorePatterns) {
    if (matchesPattern(filePath, pattern)) {
      return true;
    }
  }
  return false;
}

function matchesPattern(filePath: string, pattern: string): boolean {
  // Convert glob pattern to regex
  let regexPattern = pattern
    .replace(/\./g, '\\.')          // Escape dots
    .replace(/\*\*/g, '.*')         // ** matches any path
    .replace(/\*/g, '[^/]*')        // * matches anything except path separator
    .replace(/\?/g, '.');           // ? matches single character
  
  // Add anchors
  regexPattern = '^' + regexPattern + '$';
  
  const regex = new RegExp(regexPattern);
  return regex.test(filePath);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}