import { promises as fs } from 'fs';
import { join } from 'path';
import { loadIgnorePatterns, getCurrentStateWithBinary } from '../utils/file-utils.js';
import { writeMigrationFile } from '../utils/migration-utils.js';
import { reconstructStateFromMigrationsWithBinary } from '../utils/state-utils.js';
import { calculateDifferencesWithBinary } from '../utils/difference-utils.js';

export async function generateMigration(projectPath: string, name?: string): Promise<void> {
  const migrationsPath = join(projectPath, 'migrations');
  
  // Ensure migrations directory exists
  await fs.mkdir(migrationsPath, { recursive: true });
  
  // Load ignore patterns
  const ignorePatterns = await loadIgnorePatterns(projectPath);
  
  // Get the current state by reconstructing from existing migrations
  const reconstructedState = await reconstructStateFromMigrationsWithBinary(migrationsPath);
  
  // Get the actual current state
  const actualState = await getCurrentStateWithBinary(projectPath, ignorePatterns);
  
  // Calculate differences
  const { migration, diffContents } = await calculateDifferencesWithBinary(
    reconstructedState.textFiles,
    reconstructedState.binaryFiles,
    actualState.textFiles,
    actualState.binaryFiles,
    projectPath
  );
  
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
  
  // Save template files for new files and binary files for binary operations
  for (const [filePath, entry] of Object.entries(migration)) {
    if (entry.type === 'new') {
      const content = actualState.textFiles[filePath] || '';
      const templatePath = join(filesDir, `${filePath}.template`);
      await fs.mkdir(join(filesDir, filePath, '..'), { recursive: true });
      await fs.writeFile(templatePath, content, 'utf8');
    } else if (entry.type === 'binary') {
      // Copy binary file to __files directory for binary operations
      const sourcePath = join(projectPath, filePath);
      const binaryPath = join(filesDir, `${filePath}.binary`);
      await fs.mkdir(join(filesDir, filePath, '..'), { recursive: true });
      try {
        await fs.copyFile(sourcePath, binaryPath);
      } catch (error) {
        console.warn(`⚠️  Could not copy binary file: ${filePath}`);
      }
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