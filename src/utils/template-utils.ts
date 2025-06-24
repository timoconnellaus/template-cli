import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { readMigrationFromPath, type AppliedMigration, type AppliedMigrationsFile } from './migration-utils.js';
import { applyUnifiedDiff } from './diff-utils.js';
import { ensureDirectoryExists } from './file-utils.js';
import { select } from '@inquirer/prompts';
import { callClaudeToMergeFile } from './claude-cli.js';
import { calculateUserDiff } from './conflict-utils.js';

async function tryApplyDiffForcefully(currentContent: string, diffContent: string): Promise<string> {
  // Try to extract the target content from the diff
  // This is a simple approach - for a more robust solution, we could:
  // 1. Try fuzzy matching
  // 2. Apply only the additions
  // 3. Use a more sophisticated merge algorithm
  
  const lines = diffContent.split('\n');
  const result: string[] = [];
  
  let inHunk = false;
  
  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    
    if (line.startsWith('---') || line.startsWith('+++')) {
      continue;
    }
    
    if (inHunk) {
      if (line.startsWith('+')) {
        // Add the new line (without the +)
        result.push(line.substring(1));
      } else if (line.startsWith(' ')) {
        // Keep context line (without the space)
        result.push(line.substring(1));
      }
      // Skip lines that start with '-' (deletions)
    }
  }
  
  // If we couldn't extract meaningful content, return current content
  if (result.length === 0) {
    console.log('⚠️  Could not extract template content from diff. Keeping current content.');
    return currentContent;
  }
  
  return result.join('\n');
}

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
        // Apply unified diff to existing file
        if (entry.diffFile) {
          try {
            const diffPath = join(migrationPath, '__files', entry.diffFile);
            const diffContent = await fs.readFile(diffPath, 'utf8');
            const currentContent = await fs.readFile(targetFilePath, 'utf8');
            const newContent = applyUnifiedDiff(currentContent, diffContent);
            await fs.writeFile(targetFilePath, newContent, 'utf8');
          } catch (error) {
            // Interactive conflict resolution
            const currentContent = await fs.readFile(targetFilePath, 'utf8');
            const diffContent = await fs.readFile(join(migrationPath, '__files', entry.diffFile), 'utf8');
            
            console.log('\n🔧 Merge Conflict Detected');
            console.log('='.repeat(50));
            console.log(`File: ${filePath}`);
            console.log(`Error: ${(error as Error).message}`);
            console.log('='.repeat(50));
            
            const choice = await select({
              message: `How would you like to resolve the conflict in ${filePath}?`,
              choices: [
                { name: 'Keep my version (current content)', value: 'keep' },
                { name: 'Use template version (apply diff forcefully if possible)', value: 'template' },
                { name: 'Use Claude Code CLI to automatically merge both versions', value: 'claude' }
              ]
            });

            let resolvedContent: string;
            
            if (choice === 'keep') {
              resolvedContent = currentContent;
              console.log(`📝 Kept your version of ${filePath}`);
            } else if (choice === 'template') {
              resolvedContent = await tryApplyDiffForcefully(currentContent, diffContent);
              console.log(`📝 Applied template version of ${filePath}`);
            } else {
              // Use Claude CLI to merge
              const userDiff = await calculateUserDiff(filePath, currentContent, templatePath);
              resolvedContent = await callClaudeToMergeFile(filePath, currentContent, diffContent, userDiff, templatePath);
              console.log(`🤖 Claude Code CLI merged ${filePath}`);
            }
            
            await fs.writeFile(targetFilePath, resolvedContent, 'utf8');
          }
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
              try {
                const diffPath = join(migrationPath, '__files', entry.diffFile);
                const diffContent = await fs.readFile(diffPath, 'utf8');
                const currentContent = await fs.readFile(newFilePath, 'utf8');
                const newContent = applyUnifiedDiff(currentContent, diffContent);
                await fs.writeFile(newFilePath, newContent, 'utf8');
              } catch (error) {
                // Interactive conflict resolution for moved files
                const currentContent = await fs.readFile(newFilePath, 'utf8');
                const diffContent = await fs.readFile(join(migrationPath, '__files', entry.diffFile), 'utf8');
                const conflictFilePath = entry.newPath || filePath;
                
                console.log('\n🔧 Merge Conflict Detected');
                console.log('='.repeat(50));
                console.log(`File: ${conflictFilePath}`);
                console.log(`Error: ${(error as Error).message}`);
                console.log('='.repeat(50));
                
                const choice = await select({
                  message: `How would you like to resolve the conflict in ${conflictFilePath}?`,
                  choices: [
                    { name: 'Keep my version (current content)', value: 'keep' },
                    { name: 'Use template version (apply diff forcefully if possible)', value: 'template' },
                    { name: 'Use Claude Code CLI to automatically merge both versions', value: 'claude' }
                  ]
                });

                let resolvedContent: string;
                
                if (choice === 'keep') {
                  resolvedContent = currentContent;
                  console.log(`📝 Kept your version of ${conflictFilePath}`);
                } else if (choice === 'template') {
                  resolvedContent = await tryApplyDiffForcefully(currentContent, diffContent);
                  console.log(`📝 Applied template version of ${conflictFilePath}`);
                } else {
                  // Use Claude CLI to merge
                  const userDiff = await calculateUserDiff(conflictFilePath, currentContent, templatePath);
                  resolvedContent = await callClaudeToMergeFile(conflictFilePath, currentContent, diffContent, userDiff, templatePath);
                  console.log(`🤖 Claude Code CLI merged ${conflictFilePath}`);
                }
                
                await fs.writeFile(newFilePath, resolvedContent, 'utf8');
              }
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