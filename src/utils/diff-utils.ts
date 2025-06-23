export interface DiffChange {
  operation: 'replace' | 'insert' | 'delete';
  startLine: number;
  endLine?: number;        // for replace/delete operations
  afterLine?: number;      // for insert operations
  oldContent?: string;     // content being replaced/deleted
  newContent?: string;     // content being inserted/replacement
}

export function calculateLineDiffs(oldContent: string, newContent: string): DiffChange[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const diffs: DiffChange[] = [];
  
  // Simple line-by-line diff algorithm
  let oldIndex = 0;
  let newIndex = 0;
  
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex >= oldLines.length) {
      // Remaining lines are insertions
      const insertLines = newLines.slice(newIndex);
      if (insertLines.length > 0) {
        diffs.push({
          operation: 'insert',
          startLine: oldLines.length,
          afterLine: oldLines.length,
          newContent: insertLines.join('\n')
        });
      }
      break;
    } else if (newIndex >= newLines.length) {
      // Remaining lines are deletions
      const deleteLines = oldLines.slice(oldIndex);
      if (deleteLines.length > 0) {
        diffs.push({
          operation: 'delete',
          startLine: oldIndex + 1,
          endLine: oldLines.length,
          oldContent: deleteLines.join('\n')
        });
      }
      break;
    } else if (oldLines[oldIndex] === newLines[newIndex]) {
      // Lines are the same, move forward
      oldIndex++;
      newIndex++;
    } else {
      // Lines differ, find the best match
      const oldLine = oldLines[oldIndex];
      const newLine = newLines[newIndex];
      
      // Simple heuristic: if next lines match, this is a replacement
      if (oldIndex + 1 < oldLines.length && newIndex + 1 < newLines.length &&
          oldLines[oldIndex + 1] === newLines[newIndex + 1]) {
        // Single line replacement
        diffs.push({
          operation: 'replace',
          startLine: oldIndex + 1,
          endLine: oldIndex + 1,
          oldContent: oldLine,
          newContent: newLine
        });
        oldIndex++;
        newIndex++;
      } else {
        // For now, treat as replacement of this line
        diffs.push({
          operation: 'replace',
          startLine: oldIndex + 1,
          endLine: oldIndex + 1,
          oldContent: oldLine,
          newContent: newLine
        });
        oldIndex++;
        newIndex++;
      }
    }
  }
  
  return diffs;
}

export function applyDiffsToContent(content: string, diffs: DiffChange[]): string {
  const lines = content.split('\n');
  
  // Apply diffs in reverse order to maintain line numbers
  const sortedDiffs = [...diffs].sort((a, b) => b.startLine - a.startLine);
  
  for (const diff of sortedDiffs) {
    switch (diff.operation) {
      case 'replace':
        if (diff.endLine) {
          lines.splice(diff.startLine - 1, diff.endLine - diff.startLine + 1, diff.newContent || '');
        }
        break;
        
      case 'insert':
        if (diff.afterLine !== undefined) {
          lines.splice(diff.afterLine, 0, diff.newContent || '');
        }
        break;
        
      case 'delete':
        if (diff.endLine) {
          lines.splice(diff.startLine - 1, diff.endLine - diff.startLine + 1);
        }
        break;
    }
  }
  
  return lines.join('\n');
}