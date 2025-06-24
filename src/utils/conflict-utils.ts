import { join } from 'path';
import { reconstructStateFromMigrations } from './state-utils.js';
import { generateUnifiedDiff } from './diff-utils.js';

export async function calculateUserDiff(
  filePath: string,
  currentContent: string,
  templatePath: string = '.'
): Promise<string | null> {
  try {
    // Reconstruct the baseline state from all applied migrations
    const migrationsPath = templatePath === '.' ? 'migrations' : join(templatePath, 'migrations');
    const baselineState = await reconstructStateFromMigrations(migrationsPath);
    
    // If we couldn't reconstruct any baseline state, treat file as user-created
    if (!baselineState || Object.keys(baselineState).length === 0) {
      // No migrations have been applied or migrations directory doesn't exist
      // In this case, any file content is considered user-created
      return generateUnifiedDiff('', currentContent, '/dev/null', filePath);
    }
    
    // Get the baseline content for this file (what it looked like after all migrations but before user changes)
    const baselineContent = baselineState[filePath];
    
    // If the file doesn't exist in baseline, it means it was user-created
    if (baselineContent === undefined) {
      // This is a new file created by the user
      return generateUnifiedDiff('', currentContent, '/dev/null', filePath);
    }
    
    // If baseline and current are the same, no user changes
    if (baselineContent === currentContent) {
      return null;
    }
    
    // Generate diff from baseline to current (user changes)
    return generateUnifiedDiff(baselineContent, currentContent, `${filePath}.baseline`, filePath);
  } catch (error) {
    console.warn(`⚠️  Could not calculate user diff for ${filePath}:`, error instanceof Error ? error.message : String(error));
    // If we can't calculate the baseline, treat as user-created
    return generateUnifiedDiff('', currentContent, '/dev/null', filePath);
  }
}

