import { createHash } from 'crypto';

export interface SimilarityScore {
  migrationName: string;
  timestamp: string;
  score: number;
  exactMatches: string[];
  partialMatches: string[];
  missingFiles: string[];
  extraFiles: string[];
}

/**
 * Calculate similarity between user repository state and a template state
 */
export function calculateSimilarity(
  userState: Record<string, string>,
  templateState: Record<string, string>,
  migrationName: string,
  timestamp: string
): SimilarityScore {
  const userFiles = new Set(Object.keys(userState));
  const templateFiles = new Set(Object.keys(templateState));
  
  const exactMatches: string[] = [];
  const partialMatches: string[] = [];
  const missingFiles: string[] = [];
  const extraFiles: string[] = [];
  
  let score = 0;
  
  // Check for exact matches
  for (const filePath of templateFiles) {
    if (userFiles.has(filePath)) {
      const userContent = userState[filePath] || '';
      const templateContent = templateState[filePath] || '';
      
      if (userContent === templateContent) {
        exactMatches.push(filePath);
        score += 10; // Exact file match: +10 points
      } else {
        const similarity = calculateContentSimilarity(userContent, templateContent);
        if (similarity >= 0.8) {
          partialMatches.push(filePath);
          score += 5; // Partial content match (>=80% similar): +5 points
        } else {
          missingFiles.push(filePath);
          score -= 3; // Missing expected file: -3 points
        }
      }
    } else {
      missingFiles.push(filePath);
      score -= 3; // Missing expected file: -3 points
    }
  }
  
  // Check for extra files in user repo
  for (const filePath of userFiles) {
    if (!templateFiles.has(filePath)) {
      extraFiles.push(filePath);
      score -= 1; // Extra file in user repo: -1 point
    }
  }
  
  // Bonus for matching directory structure
  const userDirs = getDirectoryStructure(userFiles);
  const templateDirs = getDirectoryStructure(templateFiles);
  const commonDirs = userDirs.filter(dir => templateDirs.includes(dir));
  score += commonDirs.length * 2; // Matching directory structure: +2 points
  
  return {
    migrationName,
    timestamp,
    score,
    exactMatches,
    partialMatches,
    missingFiles,
    extraFiles
  };
}

/**
 * Calculate content similarity between two strings using simple hash-based comparison
 * and line-by-line analysis
 */
function calculateContentSimilarity(content1: string, content2: string): number {
  if (content1 === content2) return 1.0;
  if (!content1 || !content2) return 0.0;
  
  // Simple line-based comparison
  const lines1 = content1.split('\n');
  const lines2 = content2.split('\n');
  
  const maxLines = Math.max(lines1.length, lines2.length);
  if (maxLines === 0) return 1.0;
  
  let matchingLines = 0;
  const minLines = Math.min(lines1.length, lines2.length);
  
  for (let i = 0; i < minLines; i++) {
    if (lines1[i] === lines2[i]) {
      matchingLines++;
    }
  }
  
  return matchingLines / maxLines;
}

/**
 * Extract directory structure from file paths
 */
function getDirectoryStructure(filePaths: Set<string>): string[] {
  const dirs = new Set<string>();
  
  for (const filePath of filePaths) {
    const parts = filePath.split('/');
    let currentPath = '';
    
    // Add each parent directory
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        dirs.add(currentPath);
      }
    }
  }
  
  return Array.from(dirs);
}

/**
 * Calculate hash of a file state for quick comparison
 */
export function calculateStateHash(state: Record<string, string>): string {
  const hash = createHash('sha256');
  
  // Sort keys for consistent hashing
  const sortedKeys = Object.keys(state).sort();
  
  for (const key of sortedKeys) {
    hash.update(`${key}:${state[key]}`);
  }
  
  return hash.digest('hex');
}

/**
 * Find the best matching migration from a list of similarity scores
 */
export function findBestMatch(scores: SimilarityScore[]): SimilarityScore | null {
  if (scores.length === 0) return null;
  
  // Sort by score descending
  const sorted = scores.sort((a, b) => b.score - a.score);
  
  // Return best match if it has a reasonable score
  const best = sorted[0];
  if (best && best.score >= 0) { // At least neutral score
    return best;
  }
  
  return null;
}

/**
 * Format similarity score for display
 */
export function formatSimilarityScore(score: SimilarityScore): string {
  const percentage = Math.max(0, Math.round((score.score / (score.exactMatches.length * 10 + score.partialMatches.length * 5)) * 100));
  
  return [
    `📊 ${score.migrationName} (${percentage}% similarity, score: ${score.score})`,
    `   - ${score.exactMatches.length} exact file matches`,
    `   - ${score.partialMatches.length} files with minor differences`,
    score.missingFiles.length > 0 ? `   - ${score.missingFiles.length} files missing from your repo` : '',
    score.extraFiles.length > 0 ? `   - ${score.extraFiles.length} files only in your repo` : ''
  ].filter(Boolean).join('\n');
}