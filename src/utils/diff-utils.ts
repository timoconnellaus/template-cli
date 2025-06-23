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

// New unified diff format functions
export function generateUnifiedDiff(oldContent: string, newContent: string, oldPath: string, newPath: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  // Generate unified diff header
  const lines = [
    `--- ${oldPath}`,
    `+++ ${newPath}`,
  ];
  
  // Simple unified diff generation
  let oldIndex = 0;
  let newIndex = 0;
  const hunks: Array<{ oldStart: number; oldLength: number; newStart: number; newLength: number; lines: string[] }> = [];
  let currentHunk: { oldStart: number; oldLength: number; newStart: number; newLength: number; lines: string[] } | null = null;
  
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      // Lines are the same
      if (currentHunk) {
        currentHunk.lines.push(` ${oldLines[oldIndex]}`);
        currentHunk.oldLength++;
        currentHunk.newLength++;
      }
      oldIndex++;
      newIndex++;
    } else {
      // Start a new hunk if we don't have one
      if (!currentHunk) {
        currentHunk = {
          oldStart: oldIndex + 1,
          oldLength: 0,
          newStart: newIndex + 1,
          newLength: 0,
          lines: []
        };
        
        // Add context lines before the change (up to 3 lines)
        const contextStart = Math.max(0, oldIndex - 3);
        for (let i = contextStart; i < oldIndex; i++) {
          currentHunk.lines.push(` ${oldLines[i]}`);
          currentHunk.oldLength++;
          currentHunk.newLength++;
        }
        currentHunk.oldStart = contextStart + 1;
        currentHunk.newStart = newIndex - (oldIndex - contextStart) + 1;
      }
      
      // Handle deletions
      if (oldIndex < oldLines.length && (newIndex >= newLines.length || oldLines[oldIndex] !== newLines[newIndex])) {
        currentHunk.lines.push(`-${oldLines[oldIndex]}`);
        currentHunk.oldLength++;
        oldIndex++;
      }
      
      // Handle insertions
      if (newIndex < newLines.length && (oldIndex >= oldLines.length || oldLines[oldIndex - 1] !== newLines[newIndex])) {
        currentHunk.lines.push(`+${newLines[newIndex]}`);
        currentHunk.newLength++;
        newIndex++;
      }
      
      // Check if we should close this hunk (after finding some matching context)
      const nextMatchingLines = Math.min(3, Math.min(oldLines.length - oldIndex, newLines.length - newIndex));
      let matchingContext = 0;
      for (let i = 0; i < nextMatchingLines; i++) {
        if (oldIndex + i < oldLines.length && newIndex + i < newLines.length && 
            oldLines[oldIndex + i] === newLines[newIndex + i]) {
          matchingContext++;
        } else {
          break;
        }
      }
      
      if (matchingContext >= 3 || (oldIndex >= oldLines.length && newIndex >= newLines.length)) {
        // Add trailing context
        for (let i = 0; i < Math.min(3, matchingContext); i++) {
          if (oldIndex + i < oldLines.length) {
            currentHunk.lines.push(` ${oldLines[oldIndex + i]}`);
            currentHunk.oldLength++;
            currentHunk.newLength++;
          }
        }
        
        hunks.push(currentHunk);
        currentHunk = null;
        
        // Skip the context we just added
        oldIndex += Math.min(3, matchingContext);
        newIndex += Math.min(3, matchingContext);
      }
    }
  }
  
  // Close any remaining hunk
  if (currentHunk) {
    hunks.push(currentHunk);
  }
  
  // Generate hunk headers and content
  for (const hunk of hunks) {
    if (hunk.lines.length > 0) {
      lines.push(`@@ -${hunk.oldStart},${hunk.oldLength} +${hunk.newStart},${hunk.newLength} @@`);
      lines.push(...hunk.lines);
    }
  }
  
  return lines.join('\n');
}

export function applyUnifiedDiff(originalContent: string, diffContent: string): string {
  const diffLines = diffContent.split('\n');
  let result = originalContent.split('\n');
  
  let i = 0;
  while (i < diffLines.length) {
    const line = diffLines[i];
    
    // Skip headers
    if (line.startsWith('---') || line.startsWith('+++')) {
      i++;
      continue;
    }
    
    // Parse hunk header
    const hunkMatch = line.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
    if (hunkMatch) {
      const oldStart = parseInt(hunkMatch[1]) - 1; // Convert to 0-based
      const oldLength = parseInt(hunkMatch[2]);
      const newStart = parseInt(hunkMatch[3]) - 1; // Convert to 0-based
      const newLength = parseInt(hunkMatch[4]);
      
      i++; // Move past hunk header
      
      const newLines: string[] = [];
      let oldPos = oldStart;
      
      // Process hunk content
      while (i < diffLines.length && !diffLines[i].startsWith('@@')) {
        const hunkLine = diffLines[i];
        
        if (hunkLine.startsWith(' ')) {
          // Context line - keep as is
          newLines.push(hunkLine.substring(1));
          oldPos++;
        } else if (hunkLine.startsWith('-')) {
          // Deletion - skip the old line
          oldPos++;
        } else if (hunkLine.startsWith('+')) {
          // Addition - add the new line
          newLines.push(hunkLine.substring(1));
        }
        
        i++;
      }
      
      // Replace the old section with the new lines
      result.splice(oldStart, oldLength, ...newLines);
      continue;
    }
    
    i++;
  }
  
  return result.join('\n');
}