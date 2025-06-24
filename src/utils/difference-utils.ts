import { select, confirm } from '@inquirer/prompts';
import { generateUnifiedDiff } from './diff-utils.js';
import { type Migration } from './migration-utils.js';
import { type FileState, areBinaryFilesEqual } from './file-utils.js';
import { join } from 'path';
import { promises as fs } from 'fs';

export interface DifferenceResult {
  migration: Migration;
  diffContents: Record<string, string>; // diffFile -> diff content
}

async function getLatestBinaryFileFromMigrations(projectPath: string, filePath: string): Promise<string | null> {
  try {
    const migrationsPath = join(projectPath, 'migrations');
    const entries = await fs.readdir(migrationsPath);
    const migrationFolders = entries
      .filter(entry => entry.includes('_'))
      .sort()
      .reverse(); // Most recent first
    
    // Find the most recent migration that contains this binary file
    for (const folder of migrationFolders) {
      const binaryFilePath = join(migrationsPath, folder, '__files', `${filePath}.binary`);
      try {
        await fs.access(binaryFilePath);
        return binaryFilePath;
      } catch {
        // File doesn't exist in this migration, try the next one
        continue;
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

export async function calculateDifferences(oldState: Record<string, string>, newState: Record<string, string>): Promise<DifferenceResult> {
  const migration: Migration = {};
  const diffContents: Record<string, string> = {};
  
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
      // Modified file - generate unified diff
      const diffContent = generateUnifiedDiff(oldContent, newContent, filePath, filePath);
      if (diffContent.includes('@@')) { // Only if there are actual changes
        const diffFileName = `${filePath}.diff`;
        migration[filePath] = {
          type: 'modify',
          diffFile: diffFileName
        };
        diffContents[diffFileName] = diffContent;
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
            const diffContent = generateUnifiedDiff(oldContent || '', newContent || '', deletedPath, moveTarget);
            if (diffContent.includes('@@')) {
              const diffFileName = `${moveTarget}.diff`;
              migration[moveTarget] = {
                type: 'moved',
                oldPath: deletedPath,
                newPath: moveTarget,
                diffFile: diffFileName
              };
              diffContents[diffFileName] = diffContent;
            } else {
              // No actual changes detected
              migration[moveTarget] = {
                type: 'moved',
                oldPath: deletedPath,
                newPath: moveTarget
              };
            }
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
  
  return { migration, diffContents };
}

export async function calculateDifferencesWithBinary(
  oldTextFiles: Record<string, string>,
  oldBinaryFiles: Set<string>,
  newTextFiles: Record<string, string>,
  newBinaryFiles: Set<string>,
  projectPath: string
): Promise<DifferenceResult> {
  const migration: Migration = {};
  const diffContents: Record<string, string> = {};
  
  // Find new and modified text files
  for (const [filePath, newContent] of Object.entries(newTextFiles)) {
    const oldContent = oldTextFiles[filePath];
    
    if (oldContent === undefined) {
      // New text file
      migration[filePath] = {
        type: 'new',
        path: filePath
      };
    } else if (oldContent !== newContent) {
      // Modified text file - generate unified diff
      const diffContent = generateUnifiedDiff(oldContent, newContent, filePath, filePath);
      if (diffContent.includes('@@')) { // Only if there are actual changes
        const diffFileName = `${filePath}.diff`;
        migration[filePath] = {
          type: 'modify',
          diffFile: diffFileName
        };
        diffContents[diffFileName] = diffContent;
      }
    }
  }
  
  // Find new binary files
  for (const filePath of newBinaryFiles) {
    if (!oldBinaryFiles.has(filePath)) {
      migration[filePath] = {
        type: 'binary',
        path: filePath,
        isBinary: true
      };
    }
  }
  
  // Handle binary file modifications
  // TODO: Add proper binary file change detection here
  // For now, we'll only detect binary modifications when there are actual content changes
  // This avoids false positives but might miss some binary changes
  
  // Find files that changed from text to binary or binary to text
  for (const filePath of newBinaryFiles) {
    if (oldTextFiles[filePath] !== undefined) {
      // File changed from text to binary
      migration[filePath] = {
        type: 'binary',
        path: filePath,
        isBinary: true
      };
    }
  }
  
  for (const [filePath] of Object.entries(newTextFiles)) {
    if (oldBinaryFiles.has(filePath)) {
      // File changed from binary to text - treat as new text file
      migration[filePath] = {
        type: 'new',
        path: filePath
      };
    }
  }
  
  // Find deleted files (both text and binary)
  const deletedTextFiles = Object.keys(oldTextFiles).filter(filePath => 
    !(filePath in newTextFiles) && !newBinaryFiles.has(filePath)
  );
  const deletedBinaryFiles = Array.from(oldBinaryFiles).filter(filePath => 
    !newBinaryFiles.has(filePath) && !(filePath in newTextFiles)
  );
  
  const allDeletedFiles = [...deletedTextFiles, ...deletedBinaryFiles];
  const allNewFiles = [
    ...Object.keys(newTextFiles).filter(filePath => !(filePath in oldTextFiles) && !oldBinaryFiles.has(filePath)),
    ...Array.from(newBinaryFiles).filter(filePath => !oldBinaryFiles.has(filePath) && !(filePath in oldTextFiles))
  ];
  
  // Handle move detection for deleted files
  for (const deletedPath of allDeletedFiles) {
    if (allNewFiles.length > 0) {
      const isMove = await confirm({
        message: `File '${deletedPath}' was deleted. Was it moved/renamed?`,
        default: false
      });
      
      if (isMove) {
        const moveTarget = await select({
          message: `Which file was '${deletedPath}' moved to?`,
          choices: [
            ...allNewFiles.map(path => ({ name: path, value: path })),
            { name: '(None - it was actually deleted)', value: null }
          ]
        });
        
        if (moveTarget) {
          const wasOldBinary = oldBinaryFiles.has(deletedPath);
          const isNewBinary = newBinaryFiles.has(moveTarget);
          
          // Remove the "new" or "binary" entry for the target file since it's actually a move
          delete migration[moveTarget];
          
          if (wasOldBinary && isNewBinary) {
            // Binary to binary move
            migration[moveTarget] = {
              type: 'moved',
              oldPath: deletedPath,
              newPath: moveTarget,
              isBinary: true
            };
          } else if (!wasOldBinary && !isNewBinary) {
            // Text to text move - check for content changes
            const oldContent = oldTextFiles[deletedPath] || '';
            const newContent = newTextFiles[moveTarget] || '';
            
            if (oldContent === newContent) {
              // Simple move without changes
              migration[moveTarget] = {
                type: 'moved',
                oldPath: deletedPath,
                newPath: moveTarget
              };
            } else {
              // Move with changes
              const diffContent = generateUnifiedDiff(oldContent, newContent, deletedPath, moveTarget);
              if (diffContent.includes('@@')) {
                const diffFileName = `${moveTarget}.diff`;
                migration[moveTarget] = {
                  type: 'moved',
                  oldPath: deletedPath,
                  newPath: moveTarget,
                  diffFile: diffFileName
                };
                diffContents[diffFileName] = diffContent;
              } else {
                migration[moveTarget] = {
                  type: 'moved',
                  oldPath: deletedPath,
                  newPath: moveTarget
                };
              }
            }
          } else {
            // Binary/text conversion with move - treat as delete old + new target
            migration[deletedPath] = { type: 'delete', path: deletedPath };
            if (isNewBinary) {
              migration[moveTarget] = { type: 'binary', path: moveTarget, isBinary: true };
            } else {
              migration[moveTarget] = { type: 'new', path: moveTarget };
            }
          }
          
          // Remove from new files list
          const targetIndex = allNewFiles.indexOf(moveTarget);
          if (targetIndex > -1) {
            allNewFiles.splice(targetIndex, 1);
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
  
  // Finally, handle binary file modifications for files that exist in both states
  // but weren't already processed as conversions, new files, or deletions
  for (const filePath of newBinaryFiles) {
    if (oldBinaryFiles.has(filePath) && !migration[filePath]) {
      // Binary file exists in both states and hasn't been processed yet
      // Check if the binary content has actually changed
      const oldBinaryPath = await getLatestBinaryFileFromMigrations(projectPath, filePath);
      const newBinaryPath = join(projectPath, filePath);
      
      if (oldBinaryPath) {
        // Compare the binary files
        const filesEqual = await areBinaryFilesEqual(oldBinaryPath, newBinaryPath);
        
        if (!filesEqual) {
          // Binary file has changed, mark it as modified
          migration[filePath] = {
            type: 'binary',
            path: filePath,
            isBinary: true
          };
        }
        // If files are equal, don't add to migration (no change detected)
      } else {
        // No previous binary file found, treat as new (this shouldn't happen in normal flow)
        migration[filePath] = {
          type: 'binary',
          path: filePath,
          isBinary: true
        };
      }
    }
  }
  
  return { migration, diffContents };
}