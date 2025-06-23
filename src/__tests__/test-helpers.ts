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
  
  // Extract the migration object from the file - now it uses JSON format
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

export async function readTemplateFile(
  repoPath: string,
  migrationFolder: string,
  filePath: string
): Promise<string> {
  const templatePath = join(repoPath, 'migrations', migrationFolder, '__files', `${filePath}.template`);
  return await fs.readFile(templatePath, 'utf8');
}

export async function listMigrationFolders(repoPath: string): Promise<string[]> {
  try {
    const migrationsPath = join(repoPath, 'migrations');
    const entries = await fs.readdir(migrationsPath);
    // Look for timestamp pattern: YYYY-MM-DDTHH-mm-ss_name
    return entries.filter(entry => entry.match(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_/)).sort();
  } catch (error) {
    return [];
  }
}