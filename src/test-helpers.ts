import { simpleGit, type SimpleGit } from 'simple-git';
import { promises as fs } from 'fs';
import { join } from 'path';
import { temporaryDirectory } from 'tempy';

export interface TestRepo {
  path: string;
  git: SimpleGit;
  cleanup: () => Promise<void>;
}

export async function createTestRepo(): Promise<TestRepo> {
  const testDir = temporaryDirectory({ prefix: 'test-repo-' });
  const git = simpleGit(testDir);
  
  // Initialize git repo
  await git.init();
  await git.addConfig('user.email', 'test@example.com');
  await git.addConfig('user.name', 'Test User');
  
  return {
    path: testDir,
    git,
    cleanup: async () => {
      await fs.rm(testDir, { recursive: true });
    }
  };
}

export async function addIgnoreFileToRepo(
  repo: TestRepo,
  patterns: string[]
): Promise<void> {
  const content = patterns.join('\n');
  await addFileToRepo(repo, '.migrateignore', content);
}

export async function addFileToRepo(
  repo: TestRepo, 
  filePath: string, 
  content: string
): Promise<void> {
  const fullPath = join(repo.path, filePath);
  const dir = join(fullPath, '..');
  
  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });
  
  // Write file
  await fs.writeFile(fullPath, content, 'utf8');
  
  // Add to git
  await repo.git.add(filePath);
}

export async function commitToRepo(
  repo: TestRepo, 
  message: string
): Promise<string> {
  const result = await repo.git.commit(message);
  return result.commit;
}

export async function modifyFileInRepo(
  repo: TestRepo,
  filePath: string,
  newContent: string
): Promise<void> {
  const fullPath = join(repo.path, filePath);
  await fs.writeFile(fullPath, newContent, 'utf8');
  await repo.git.add(filePath);
}

export async function deleteFileFromRepo(
  repo: TestRepo,
  filePath: string
): Promise<void> {
  const fullPath = join(repo.path, filePath);
  await fs.unlink(fullPath);
  await repo.git.add(filePath);
}

export async function readMigrationFile(
  repoPath: string,
  migrationFolder: string
): Promise<any> {
  const migrationPath = join(repoPath, 'migrations', migrationFolder, 'migrate.ts');
  const content = await fs.readFile(migrationPath, 'utf8');
  
  // Extract the migration object from the file - now it uses template literals
  const match = content.match(/export const migration = \{(.*)\} as const;/s);
  if (!match || !match[1]) {
    throw new Error('Could not parse migration file');
  }
  
  // Parse the migration entries manually since they use template literals
  const migrationContent = match[1].trim();
  const result: any = {};
  
  // Parse each key-value pair by finding complete entries
  let i = 0;
  while (i < migrationContent.length) {
    // Skip whitespace and newlines
    while (i < migrationContent.length && /\s/.test(migrationContent[i]!)) {
      i++;
    }
    
    if (i >= migrationContent.length) break;
    
    // Find the key (should start with quote)
    if (migrationContent[i] !== '"') {
      i++;
      continue;
    }
    
    // Extract key
    i++; // skip opening quote
    let key = '';
    while (i < migrationContent.length && migrationContent[i] !== '"') {
      key += migrationContent[i];
      i++;
    }
    i++; // skip closing quote
    
    // Skip to colon
    while (i < migrationContent.length && migrationContent[i] !== ':') {
      i++;
    }
    i++; // skip colon
    
    // Skip whitespace
    while (i < migrationContent.length && /\s/.test(migrationContent[i]!)) {
      i++;
    }
    
    // Parse value
    if (i >= migrationContent.length) break;
    
    if (migrationContent[i] === '`') {
      // Template literal
      i++; // skip opening backtick
      let value = '';
      while (i < migrationContent.length && migrationContent[i] !== '`') {
        if (migrationContent[i] === '\\' && i + 1 < migrationContent.length) {
          // Handle escape sequences
          i++;
          if (migrationContent[i] === '`') {
            value += '`';
          } else if (migrationContent[i] === '\\') {
            value += '\\';
          } else if (migrationContent[i] === '$' && i + 1 < migrationContent.length && migrationContent[i + 1] === '{') {
            value += '${';
            i++; // skip the '{'
          } else {
            value += '\\' + migrationContent[i];
          }
        } else {
          value += migrationContent[i];
        }
        i++;
      }
      i++; // skip closing backtick
      result[key] = value;
    } else if (migrationContent[i] === '[') {
      // Array
      const arrayItems = [];
      i++; // skip opening bracket
      
      while (i < migrationContent.length && migrationContent[i] !== ']') {
        // Skip whitespace and commas
        while (i < migrationContent.length && /[\s,]/.test(migrationContent[i]!)) {
          i++;
        }
        
        if (i >= migrationContent.length || migrationContent[i] === ']') break;
        
        if (migrationContent[i] === '`') {
          // Template literal in array
          i++; // skip opening backtick
          let value = '';
          while (i < migrationContent.length && migrationContent[i] !== '`') {
            if (migrationContent[i] === '\\' && i + 1 < migrationContent.length) {
              i++;
              if (migrationContent[i] === '`') {
                value += '`';
              } else if (migrationContent[i] === '\\') {
                value += '\\';
              } else if (migrationContent[i] === '$' && i + 1 < migrationContent.length && migrationContent[i + 1] === '{') {
                value += '${';
                i++; // skip the '{'
              } else {
                value += '\\' + migrationContent[i];
              }
            } else {
              value += migrationContent[i];
            }
            i++;
          }
          i++; // skip closing backtick
          arrayItems.push(value);
        }
      }
      i++; // skip closing bracket
      result[key] = arrayItems;
    } else if (migrationContent[i] === '{') {
      // JSON object (like {deleted: true})
      let depth = 0;
      let jsonStr = '';
      while (i < migrationContent.length && (depth > 0 || migrationContent[i] !== ',')) {
        if (migrationContent[i] === '{') depth++;
        else if (migrationContent[i] === '}') depth--;
        jsonStr += migrationContent[i];
        i++;
        if (depth === 0 && migrationContent[i-1] === '}') break;
      }
      result[key] = JSON.parse(jsonStr);
    }
    
    // Skip to next entry (past comma)
    while (i < migrationContent.length && migrationContent[i] !== ',' && migrationContent[i] !== '}') {
      i++;
    }
    if (i < migrationContent.length && migrationContent[i] === ',') {
      i++; // skip comma
    }
  }
  
  return result;
}

export async function listMigrationFolders(repoPath: string): Promise<string[]> {
  try {
    const migrationsPath = join(repoPath, 'migrations');
    const entries = await fs.readdir(migrationsPath);
    return entries.filter(entry => entry.match(/^\d+_/)).sort();
  } catch (error) {
    return [];
  }
}