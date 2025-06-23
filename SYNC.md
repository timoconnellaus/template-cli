# Template Sync Methodology - Historical Reconstruction

## Problem Statement
When a user has an existing repository that:
- Was originally based on a template (or matches a template structure)
- Has NO `applied-migrations.json` file
- Has diverged with their own changes
- Wants to sync with the template and establish migration tracking

## Solution: Historical Reconstruction

This approach intelligently detects where in the template's migration history the user's repository best matches, then establishes tracking from that point.

### 1. Overview

The sync command analyzes the user's repository against all historical states of the template (reconstructed from migrations) to find the best matching point. Once detected, it creates an `applied-migrations.json` file marking that point and applies any newer migrations.

### 2. Implementation: Sync Command

```bash
bun run dev sync --template <path>
```

### 3. Process Flow

1. **Template Analysis**
   - Load all migrations from the template repository
   - Reconstruct the template state at each migration point
   - Build a map of historical states

2. **User Repository Analysis**
   - Scan the user's repository (respecting `.migrateignore`)
   - Create a snapshot of current file structure and contents

3. **Similarity Matching**
   - Compare user's repository against each historical template state
   - Score each comparison based on file matches and content similarity
   - Identify the best matching migration point

4. **Tracking Establishment**
   - Create `applied-migrations.json` marking the detected point
   - Show user which migrations are marked as already applied
   - Display which new migrations will be available to apply

5. **Migration Application**
   - Optionally run the update command to apply pending migrations
   - Use existing conflict resolution for any conflicts

### 4. Similarity Detection Algorithm

```typescript
interface SimilarityScore {
  migrationName: string;
  timestamp: string;
  score: number;
  exactMatches: string[];
  partialMatches: string[];
  missingFiles: string[];
  extraFiles: string[];
}
```

Scoring algorithm:
- Exact file match: +10 points
- Partial content match (>80% similar): +5 points  
- Missing expected file: -3 points
- Extra file in user repo: -1 point
- Matching directory structure: +2 points

### 5. User Experience Flow

```
$ bun run dev sync --template ../my-template

🔍 Analyzing your repository...
No applied-migrations.json found. Analyzing against template history...

📊 Similarity Analysis Results:
✅ Best match found: "2025-06-20T10-00-00_add-auth-system" (85% similarity)
   - 12 exact file matches
   - 3 files with minor differences  
   - 2 files only in your repo
   - 5 newer migrations available to apply

❓ Proceed with synchronization? This will:
   1. Create applied-migrations.json marking this point
   2. Make 5 newer migrations available for update
   
Continue? (y/N): _
```

### 6. Implementation Details

```typescript
async function syncRepository(templatePath: string, userPath: string) {
  // 1. Validate inputs
  if (await fileExists(join(userPath, 'applied-migrations.json'))) {
    throw new Error('Repository already has migration tracking. Use "update" command instead.');
  }
  
  // 2. Load and reconstruct all template states
  const migrations = await loadMigrations(templatePath);
  const states = new Map<string, FileState>();
  
  for (const migration of migrations) {
    const state = await applyMigrationToState(previousState, migration);
    states.set(migration.name, state);
  }
  
  // 3. Analyze user repository
  const userState = await scanDirectory(userPath);
  
  // 4. Find best match
  const scores = await calculateScores(userState, states);
  const bestMatch = scores.sort((a, b) => b.score - a.score)[0];
  
  // 5. Present results and get confirmation
  displayAnalysisResults(bestMatch, scores);
  
  if (await confirmSync()) {
    // 6. Create tracking file
    await createAppliedMigrationsFile(userPath, templatePath, bestMatch);
    
    // 7. Show next steps
    console.log('✅ Sync complete! Run "bun run dev update" to apply newer migrations.');
  }
}
```

### 7. Technical Considerations

1. **State Reconstruction**
   - Reuse existing `reconstructState` functionality from state-utils
   - Cache reconstructed states for performance
   - Handle large templates efficiently

2. **Similarity Calculation**
   - Use hash-based comparison for exact matches
   - Implement efficient diff algorithm for partial matches
   - Consider file paths and directory structure

3. **Edge Cases**
   - Empty user repository
   - No migrations in template
   - Perfect match with latest state
   - No good matches found (similarity < 50%)

### 8. Safety Measures

1. **Non-destructive Operation**
   - Only creates `applied-migrations.json`
   - Does not modify any existing files
   - User must explicitly run update after sync

2. **Validation**
   - Check git status before proceeding
   - Verify template has valid migrations
   - Ensure no existing tracking file

3. **Clear Communication**
   - Show exactly what will happen
   - Explain the detected sync point
   - Provide clear next steps

## Benefits

This historical reconstruction approach:
- Automatically finds the right starting point for migration tracking
- Preserves all user customizations
- Integrates seamlessly with existing update mechanism
- Provides clear visibility into the sync process
- Minimizes manual intervention and guesswork