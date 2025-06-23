import { promises as fs } from 'fs';
import { join } from 'path';
import { loadIgnorePatterns, getCurrentState } from '../utils/file-utils.js';
import { writeMigrationFile } from '../utils/migration-utils.js';
import { reconstructStateFromMigrations } from '../utils/state-utils.js';
import { calculateDifferences } from '../utils/difference-utils.js';

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
  const { migration, diffContents } = await calculateDifferences(reconstructedState, actualState);
  
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
  
  // Save template files for new files and diff files for modifications
  for (const [filePath, entry] of Object.entries(migration)) {
    if (entry.type === 'new') {
      const content = actualState[filePath] || '';
      const templatePath = join(filesDir, `${filePath}.template`);
      await fs.mkdir(join(filesDir, filePath, '..'), { recursive: true });
      await fs.writeFile(templatePath, content, 'utf8');
    }
  }
  
  // Save diff files
  for (const [diffFileName, diffContent] of Object.entries(diffContents)) {
    const diffPath = join(filesDir, diffFileName);
    await fs.mkdir(join(filesDir, diffFileName, '..'), { recursive: true });
    await fs.writeFile(diffPath, diffContent, 'utf8');
  }
  
  // Write migration file
  await writeMigrationFile(migrationFilePath, migration);
  
  console.log(`✅ Migration '${folderName}' generated successfully`);
  console.log(`📁 Created: ${migrationFolderPath}`);
}