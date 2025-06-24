import { promises as fs } from 'fs';
import { join } from 'path';

export interface MigrationEntry {
  type: 'new' | 'delete' | 'modify' | 'moved' | 'binary';
  path?: string;
  oldPath?: string;  // for moved files
  newPath?: string;  // for moved files
  diffFile?: string; // path to .diff file for modify/moved operations
  isBinary?: boolean; // indicates if this is a binary file operation
  featureExclusive?: string; // feature that must be enabled for this entry
  features?: Record<string, string>; // feature-specific diff files
}

export interface Migration {
  [key: string]: MigrationEntry;
}

export interface MigrationFile {
  migration: Migration;
}

export interface AppliedMigration {
  name: string;
  appliedAt: string;
}

export interface SkippedMigration {
  name: string;
  reason: string;
  timestamp?: string;
}

export interface AppliedMigrationsFile {
  version: string;
  template: string;
  appliedMigrations: AppliedMigration[];
  enabledFeatures?: string[];
  skippedMigrations?: SkippedMigration[];
  featureFiles?: Record<string, string[]>;
}

export async function parseMigrationFile(content: string): Promise<Migration> {
  // Extract the migration object from the file
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

export async function writeMigrationFile(filePath: string, migration: Migration): Promise<void> {
  const formatMigrationEntry = (entry: MigrationEntry): string => {
    return JSON.stringify(entry, null, 2).replace(/\n/g, '\n  ');
  };

  const migrationEntries = Object.entries(migration).map(([key, value]) => {
    const formattedValue = formatMigrationEntry(value);
    return `  "${key}": ${formattedValue}`;
  }).join(',\n');

  const migrationContent = `// Migration generated automatically
export const migration = {
${migrationEntries}
} as const;
`;
  
  await fs.writeFile(filePath, migrationContent, 'utf8');
}

export async function readMigrationFromPath(migrationPath: string): Promise<MigrationFile> {
  const migrationFilePath = join(migrationPath, 'migrate.ts');
  const content = await fs.readFile(migrationFilePath, 'utf8');
  
  // Extract the migration object from the file
  const match = content.match(/export const migration = \{(.*)\} as const;/s);
  if (!match || !match[1]) {
    throw new Error('Could not parse migration file');
  }
  
  // Use eval to parse the object since it's our own generated format
  const migrationContent = `{${match[1]}}`;
  
  try {
    const migration = eval(`(${migrationContent})`);
    return { migration };
  } catch (error) {
    throw new Error(`Could not parse migration content: ${error}`);
  }
}