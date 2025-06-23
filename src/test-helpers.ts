import { simpleGit, type SimpleGit } from 'simple-git';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface TestRepo {
  path: string;
  git: SimpleGit;
  cleanup: () => Promise<void>;
}

export async function createTestRepo(): Promise<TestRepo> {
  const testDir = await fs.mkdtemp(join(tmpdir(), 'test-repo-'));
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
  
  // Extract the migration object from the file
  const match = content.match(/export const migration = (.*) as const;/s);
  if (!match || !match[1]) {
    throw new Error('Could not parse migration file');
  }
  
  return JSON.parse(match[1]);
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