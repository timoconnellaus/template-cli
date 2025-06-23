import { select, confirm } from '@inquirer/prompts';
import { calculateLineDiffs } from './diff-utils.js';
import { type Migration } from './migration-utils.js';

export async function calculateDifferences(oldState: Record<string, string>, newState: Record<string, string>): Promise<Migration> {
  const migration: Migration = {};
  
  // Find new and modified files
  for (const [filePath, newContent] of Object.entries(newState)) {
    const oldContent = oldState[filePath];
    
    if (oldContent === undefined) {
      // New file
      migration[filePath] = {
        type: 'new',
        path: filePath
      };
    } else if (oldContent !== newContent) {
      // Modified file - calculate line-by-line diffs
      const diffs = calculateLineDiffs(oldContent, newContent);
      if (diffs.length > 0) {
        migration[filePath] = {
          type: 'modify',
          diffs: diffs
        };
      }
    }
  }
  
  // Find deleted files and handle move detection
  const deletedFiles = Object.keys(oldState).filter(filePath => !(filePath in newState));
  const newFiles = Object.keys(newState).filter(filePath => !(filePath in oldState));
  
  
  for (const deletedPath of deletedFiles) {
    // Check if this might be a move by prompting the user
    if (newFiles.length > 0) {
      const isMove = await confirm({
        message: `File '${deletedPath}' was deleted. Was it moved/renamed?`,
        default: false
      });
      
      if (isMove) {
        // Let user select which new file this was moved to
        const moveTarget = await select({
          message: `Which file was '${deletedPath}' moved to?`,
          choices: [
            ...newFiles.map(path => ({ name: path, value: path })),
            { name: '(None - it was actually deleted)', value: null }
          ]
        });
        
        if (moveTarget) {
          // This is a move operation
          const oldContent = oldState[deletedPath];
          const newContent = newState[moveTarget];
          
          // Remove the "new" entry for the target file since it's actually a move
          delete migration[moveTarget];
          
          // Create move entry
          if (oldContent === newContent) {
            // Simple move without changes
            migration[moveTarget] = {
              type: 'moved',
              oldPath: deletedPath,
              newPath: moveTarget
            };
          } else {
            // Move with changes
            const diffs = calculateLineDiffs(oldContent || '', newContent || '');
            migration[moveTarget] = {
              type: 'moved',
              oldPath: deletedPath,
              newPath: moveTarget,
              diffs: diffs
            };
          }
          
          // Remove this file from the newFiles list so it's not offered again
          const targetIndex = newFiles.indexOf(moveTarget);
          if (targetIndex > -1) {
            newFiles.splice(targetIndex, 1);
          }
          
          continue; // Skip adding as delete
        }
      }
    }
    
    // Not a move, so it's a delete
    migration[deletedPath] = {
      type: 'delete',
      path: deletedPath
    };
  }
  
  return migration;
}