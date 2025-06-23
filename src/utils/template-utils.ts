import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { readMigrationFromPath, type AppliedMigration, type AppliedMigrationsFile } from './migration-utils.js';
import { applyDiffsToContent, applyUnifiedDiff } from './diff-utils.js';
import { ensureDirectoryExists } from './file-utils.js';

export async function applyAllMigrations(templatePath: string, targetPath: string): Promise<void> {
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

export async function applyMigration(templatePath: string, targetPath: string, migrationFolder: string): Promise<void> {
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
        if (entry.diffFile) {
          // New unified diff format
          try {
            const diffPath = join(migrationPath, '__files', entry.diffFile);
            const diffContent = await fs.readFile(diffPath, 'utf8');
            const currentContent = await fs.readFile(targetFilePath, 'utf8');
            const newContent = applyUnifiedDiff(currentContent, diffContent);
            await fs.writeFile(targetFilePath, newContent, 'utf8');
          } catch (error) {
            console.warn(`⚠️  Could not apply diff file: ${entry.diffFile}`);
          }
        } else if (entry.diffs) {
          // Legacy inline diff format
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
            if (entry.diffFile) {
              // New unified diff format
              try {
                const diffPath = join(migrationPath, '__files', entry.diffFile);
                const diffContent = await fs.readFile(diffPath, 'utf8');
                const currentContent = await fs.readFile(newFilePath, 'utf8');
                const newContent = applyUnifiedDiff(currentContent, diffContent);
                await fs.writeFile(newFilePath, newContent, 'utf8');
              } catch (error) {
                console.warn(`⚠️  Could not apply diff file: ${entry.diffFile}`);
              }
            } else if (entry.diffs) {
              // Legacy inline diff format
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

export async function copyTemplate(templatePath: string, targetPath: string): Promise<void> {
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