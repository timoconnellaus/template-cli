import { promises as fs } from 'fs';
import { join } from 'path';

export async function loadIgnorePatterns(projectPath: string): Promise<string[]> {
  const migrateIgnorePath = join(projectPath, '.migrateignore');
  const gitIgnorePath = join(projectPath, '.gitignore');
  
  const defaultPatterns = [
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
  
  const allPatterns = [...defaultPatterns];
  
  // Load .gitignore patterns first
  try {
    const gitIgnoreContent = await fs.readFile(gitIgnorePath, 'utf8');
    const gitIgnorePatterns = gitIgnoreContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    allPatterns.push(...gitIgnorePatterns);
  } catch (error) {
    // .gitignore doesn't exist or can't be read, continue
  }
  
  // Load .migrateignore patterns (these can override .gitignore patterns)
  try {
    const migrateIgnoreContent = await fs.readFile(migrateIgnorePath, 'utf8');
    const migrateIgnorePatterns = migrateIgnoreContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    allPatterns.push(...migrateIgnorePatterns);
  } catch (error) {
    // .migrateignore doesn't exist, use only default + gitignore patterns
  }
  
  return allPatterns;
}

export function shouldIgnoreFile(filePath: string, ignorePatterns: string[]): boolean {
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

export function matchesGitignorePattern(filePath: string, pattern: string): boolean {
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

export async function getCurrentState(projectPath: string, ignorePatterns: string[]): Promise<Record<string, string>> {
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

export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    // Directory might already exist, that's ok
  }
}