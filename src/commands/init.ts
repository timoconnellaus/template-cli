import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { confirm } from '@inquirer/prompts';
import { applyAllMigrations, copyTemplate } from '../utils/template-utils.js';
import { type AppliedMigrationsFile } from '../utils/migration-utils.js';

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