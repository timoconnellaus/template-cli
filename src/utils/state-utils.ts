import { promises as fs, readdirSync } from 'fs';
import { join } from 'path';
import { parseMigrationFile } from './migration-utils.js';
import { applyUnifiedDiff } from './diff-utils.js';

export interface MigrationInfo {
  name: string;
  timestamp: string;
  path: string;
}

export function getAllMigrationDirectories(templatePath: string): MigrationInfo[] {
  const migrationsPath = join(templatePath, 'migrations');
  
  try {
    const entries = readdirSync(migrationsPath);
    return entries
      .filter((entry: string) => entry.includes('_'))
      .sort()
      .map((entry: string) => ({
        name: entry,
        timestamp: entry.split('_')[0],
        path: join(migrationsPath, entry)
      }));
  } catch (error) {
    return [];
  }
}

export async function reconstructStateFromMigrations(migrationsPath: string): Promise<Record<string, string>> {
  const state: Record<string, string> = {};
  
  try {
    // Get all migration folders sorted by name (timestamp order)
    const entries = await fs.readdir(migrationsPath);
    const migrationFolders = entries
      .filter(entry => entry.includes('_'))
      .sort();
    
    // Apply each migration in order
    for (const folder of migrationFolders) {
      const migrationPath = join(migrationsPath, folder, 'migrate.ts');
      const filesPath = join(migrationsPath, folder, '__files');
      
      try {
        // Read the migration file
        const migrationContent = await fs.readFile(migrationPath, 'utf8');
        const migration = await parseMigrationFile(migrationContent);
        
        // Apply migration to state
        for (const [filePath, entry] of Object.entries(migration)) {
          if (entry.type === 'new') {
            // Load content from template file
            try {
              const templatePath = join(filesPath, `${filePath}.template`);
              const content = await fs.readFile(templatePath, 'utf8');
              state[filePath] = content;
            } catch (error) {
              // If template file doesn't exist, skip
            }
          } else if (entry.type === 'delete') {
            delete state[filePath];
          } else if (entry.type === 'modify') {
            // Apply diffs to existing file
            if (entry.diffFile) {
              // New unified diff format
              try {
                const diffPath = join(filesPath, entry.diffFile);
                const diffContent = await fs.readFile(diffPath, 'utf8');
                state[filePath] = applyUnifiedDiff(state[filePath] || '', diffContent);
              } catch (error) {
                console.warn(`⚠️  Could not read diff file: ${entry.diffFile}`);
              }
            }
          } else if (entry.type === 'moved') {
            // Handle file move
            const oldPath = entry.oldPath;
            const newPath = entry.newPath || filePath;
            
            if (oldPath && state[oldPath]) {
              // Move the content from old path to new path
              let content = state[oldPath];
              
              // Apply diffs if the moved file also has changes
              if (entry.diffFile) {
                // New unified diff format
                try {
                  const diffPath = join(filesPath, entry.diffFile);
                  const diffContent = await fs.readFile(diffPath, 'utf8');
                  content = applyUnifiedDiff(content, diffContent);
                } catch (error) {
                  console.warn(`⚠️  Could not read diff file: ${entry.diffFile}`);
                }
              }
              
              state[newPath] = content;
              delete state[oldPath];
            }
          }
        }
      } catch (error) {
        // Skip malformed migration files
        console.warn(`⚠️  Skipping malformed migration: ${folder}`);
      }
    }
  } catch (error) {
    // No migrations directory exists yet
  }
  
  return state;
}

export async function reconstructStateIncrementally(migrationsPath: string): Promise<Map<string, Record<string, string>>> {
  const states = new Map<string, Record<string, string>>();
  let currentState: Record<string, string> = {};
  
  // Add initial empty state
  states.set('initial-state', { ...currentState });
  
  try {
    // Get all migration folders sorted by name (timestamp order)
    const entries = await fs.readdir(migrationsPath);
    const migrationFolders = entries
      .filter(entry => entry.includes('_'))
      .sort();
    
    // Apply each migration incrementally
    for (const folder of migrationFolders) {
      const migrationPath = join(migrationsPath, folder, 'migrate.ts');
      const filesPath = join(migrationsPath, folder, '__files');
      
      try {
        // Read the migration file
        const migrationContent = await fs.readFile(migrationPath, 'utf8');
        const migration = await parseMigrationFile(migrationContent);
        
        // Apply migration to current state
        for (const [filePath, entry] of Object.entries(migration)) {
          if (entry.type === 'new') {
            // Load content from template file
            try {
              const templatePath = join(filesPath, `${filePath}.template`);
              const content = await fs.readFile(templatePath, 'utf8');
              currentState[filePath] = content;
            } catch (error) {
              // If template file doesn't exist, skip
            }
          } else if (entry.type === 'delete') {
            delete currentState[filePath];
          } else if (entry.type === 'modify') {
            // Apply diffs to existing file
            if (entry.diffFile) {
              // New unified diff format
              try {
                const diffPath = join(filesPath, entry.diffFile);
                const diffContent = await fs.readFile(diffPath, 'utf8');
                currentState[filePath] = applyUnifiedDiff(currentState[filePath] || '', diffContent);
              } catch (error) {
                console.warn(`⚠️  Could not read diff file: ${entry.diffFile}`);
              }
            }
          } else if (entry.type === 'moved') {
            // Handle file move
            const oldPath = entry.oldPath;
            const newPath = entry.newPath || filePath;
            
            if (oldPath && currentState[oldPath]) {
              // Move the content from old path to new path
              let content = currentState[oldPath];
              
              // Apply diffs if the moved file also has changes
              if (entry.diffFile) {
                // New unified diff format
                try {
                  const diffPath = join(filesPath, entry.diffFile);
                  const diffContent = await fs.readFile(diffPath, 'utf8');
                  content = applyUnifiedDiff(content, diffContent);
                } catch (error) {
                  console.warn(`⚠️  Could not read diff file: ${entry.diffFile}`);
                }
              }
              
              currentState[newPath] = content;
              delete currentState[oldPath];
            }
          }
        }
        
        // Store a snapshot of the state after this migration
        states.set(folder, { ...currentState });
      } catch (error) {
        // Skip malformed migration files
        console.warn(`⚠️  Skipping malformed migration: ${folder}`);
      }
    }
  } catch (error) {
    // No migrations directory exists yet
  }
  
  return states;
}