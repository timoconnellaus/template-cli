// Unified diff format functions
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
      
      // Validate that we have enough lines in the original content
      if (oldStart + oldLength > result.length) {
        throw new Error(`Hunk extends beyond file length. Expected ${oldLength} lines starting at ${oldStart + 1}, but file only has ${result.length} lines.`);
      }
      
      i++; // Move past hunk header
      
      const newLines: string[] = [];
      let oldPos = oldStart;
      let contextValidation: Array<{expected: string, actual: string}> = [];
      
      // Process hunk content and validate context
      while (i < diffLines.length && !diffLines[i].startsWith('@@')) {
        const hunkLine = diffLines[i];
        
        if (hunkLine.startsWith(' ')) {
          // Context line - validate it matches the original
          const expectedContent = hunkLine.substring(1);
          const actualContent = result[oldPos];
          
          if (actualContent !== expectedContent) {
            contextValidation.push({expected: expectedContent, actual: actualContent || '<EOF>'});
          }
          
          newLines.push(expectedContent);
          oldPos++;
        } else if (hunkLine.startsWith('-')) {
          // Deletion - validate the line matches what we expect to delete
          const expectedToDelete = hunkLine.substring(1);
          const actualContent = result[oldPos];
          
          if (actualContent !== expectedToDelete) {
            throw new Error(`Line to delete doesn't match. Expected: "${expectedToDelete}", but found: "${actualContent || '<EOF>'}"`);
          }
          
          oldPos++;
        } else if (hunkLine.startsWith('+')) {
          // Addition - add the new line
          newLines.push(hunkLine.substring(1));
        }
        
        i++;
      }
      
      // If context validation failed, throw an error
      if (contextValidation.length > 0) {
        const mismatchDetails = contextValidation.map(cv => `Expected: "${cv.expected}", Found: "${cv.actual}"`).join('; ');
        throw new Error(`Context lines don't match. ${mismatchDetails}`);
      }
      
      // Replace the old section with the new lines
      result.splice(oldStart, oldLength, ...newLines);
      continue;
    }
    
    i++;
  }
  
  return result.join('\n');
}