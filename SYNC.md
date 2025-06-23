# Template Sync Methodology - Historical Reconstruction

## Problem Statement
When a user has an existing repository that:
- Was originally based on a template (or matches a template structure)
- Has NO `applied-migrations.json` file
- Has diverged with their own changes
- Wants to sync with the template and establish migration tracking

## Solution: Historical Reconstruction

This approach intelligently detects where in the template's migration history the user's repository best matches, then establishes tracking from that point using incremental state reconstruction.

### 1. Overview

The sync command analyzes the user's repository against all historical states of the template (reconstructed incrementally from migrations) to find the best matching point. Once detected, it creates an `applied-migrations.json` file marking that point, making newer migrations available for application.

### 2. Implementation: Sync Command

**CLI Interface:**
```bash
template-cli sync --template <path> [--path <target-path>]
```

**Examples:**
```bash
# Sync current directory with template
template-cli sync --template ../my-template

# Sync specific directory
template-cli sync --template ../my-template --path ./my-project
```

### 3. Process Flow

1. **Validation**
   - Check if `applied-migrations.json` already exists (error if found)
   - Validate template path exists and contains migrations
   - Ensure user repository is not empty

2. **Template Analysis**
   - Load all migrations from the template repository
   - **Incrementally reconstruct** template state at each migration point
   - Build a map of historical states using `reconstructStateIncrementally()`

3. **User Repository Analysis**
   - Scan the user's repository (respecting `.migrateignore`)
   - Create a snapshot of current file structure and contents

4. **Similarity Matching**
   - Compare user's repository against each historical template state
   - Score each comparison using comprehensive similarity algorithm
   - Identify the best matching migration point using `findBestMatch()`
   - Display detailed list of missing and extra files for each match

5. **User Confirmation**
   - Display detailed similarity analysis results
   - Show which migrations would be marked as applied
   - Show how many newer migrations would be available
   - Require explicit user confirmation before proceeding

6. **Tracking Establishment**
   - Create `applied-migrations.json` marking the detected point
   - Include all migrations up to the best match as "applied"
   - Provide clear next steps for applying newer migrations

### 4. Similarity Detection Algorithm

**Implementation:** `src/utils/similarity-utils.ts`

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

**Scoring Algorithm:**
- **Exact file match**: +10 points (identical content)
- **Partial content match**: +5 points (>80% line-by-line similarity)
- **Missing expected file**: -3 points (template has file, user doesn't)
- **Extra file in user repo**: -1 point (user has file, template doesn't)
- **Matching directory structure**: +2 points per matching directory

**Threshold:** Scores ≥ 0 are considered valid matches. Negative scores are rejected.

**Best Match Selection:** Uses `findBestMatch()` to select the highest scoring historical state.

### 5. User Experience Flow

```
$ template-cli sync --template ../my-template

🔍 Analyzing your repository...
No applied-migrations.json found. Analyzing against template history...

📊 Calculating similarity scores...

📊 Similarity Analysis Results:
✅ Best match found: "2025-06-20T10-00-00_add-auth-system"
   - 12 exact file matches
   - 3 files with minor differences  
   - 2 files only in your repo:
     • custom-config.js
     • my-custom-script.sh
   - 1 files missing from your repo:
     • auth/middleware.js

🔄 After synchronization:
   - 5 newer migrations will be available to apply

❓ Proceed with synchronization? This will:
   1. Create applied-migrations.json marking this sync point
   2. Make 5 migration(s) available for update
   
Continue? No

❌ Synchronization cancelled.
```

**Successful Sync:**
```
$ template-cli sync --template ../my-template

🔍 Analyzing your repository...
📊 Calculating similarity scores...

✅ Best match found: "2025-06-20T10-00-00_add-auth-system"
Continue? Yes

✅ Sync complete!
📝 Created applied-migrations.json with 3 applied migration(s)
🔄 Run "template-cli update" to apply 5 pending migration(s)
```

### 6. Implementation Details

**Core Function:** `src/commands/sync.ts`

```typescript
async function syncWithTemplate(templatePath: string, targetPath: string = process.cwd()) {
  // 1. Validation
  if (existsSync(join(targetPath, "applied-migrations.json"))) {
    console.log("❌ Repository already has migration tracking. Use 'update' command instead.");
    return;
  }
  
  // 2. Incremental state reconstruction
  const historicalStates = await reconstructStateIncrementally(migrationsPath);
  
  // 3. Analyze user repository
  const userState = await getCurrentState(targetPath, ignorePatterns);
  
  // 4. Calculate similarity scores for each historical state
  const scores: SimilarityScore[] = [];
  for (const [stateName, templateState] of historicalStates) {
    const score = calculateSimilarity(userState, templateState, stateName, timestamp);
    scores.push(score);
  }
  
  // 5. Find best match
  const bestMatch = findBestMatch(scores);
  
  // 6. User confirmation
  const shouldProceed = await confirm({ message: "Continue?", default: false });
  
  // 7. Create applied-migrations.json
  if (shouldProceed) {
    const appliedMigrations = createAppliedMigrationsFile(templatePath, bestMatch);
    writeFileSync(appliedMigrationsPath, JSON.stringify(appliedMigrations, null, 2));
  }
}
```

**Key Implementation Features:**

1. **Incremental Reconstruction**: Uses `reconstructStateIncrementally()` instead of `reconstructStateFromMigrations()` for accurate historical state building

2. **Comprehensive Validation**: Checks for existing tracking, template validity, and empty repositories

3. **Performance Optimized**: Handles large template histories efficiently (25+ migrations in <10s)

4. **User-Centric**: Requires explicit confirmation and provides clear next steps

### 7. Technical Considerations

1. **State Reconstruction**
   - Uses `reconstructStateIncrementally()` for proper historical state building
   - Each historical state is reconstructed by applying migrations sequentially
   - Optimized for large template histories (handles 25+ migrations efficiently)
   - Memory-efficient incremental reconstruction vs full state reconstruction

2. **Similarity Calculation**
   - Hash-based comparison for exact file content matches
   - Line-by-line similarity analysis for partial matches (>80% threshold)
   - Directory structure scoring for organizational similarity
   - Weighted scoring system balances precision vs recall

3. **Edge Cases Handled**
   - Empty user repository (requires minimum file threshold)
   - Template with no migrations (fallback to current state comparison)
   - Perfect match with latest state (marks all migrations as applied)
   - No good matches found (score < 0, requires user decision)
   - Multiple equally good matches (selects most recent by timestamp)

### 8. Safety Measures

1. **Non-destructive Operation**
   - Only creates `applied-migrations.json` tracking file
   - Never modifies existing user files during sync process
   - User must explicitly run `template-cli update` after sync to apply changes
   - Can be safely cancelled without side effects

2. **Comprehensive Validation**
   - Checks for existing `applied-migrations.json` (prevents double-sync)
   - Validates template path exists and contains valid migrations
   - Ensures user repository is not empty (minimum file threshold)
   - Verifies git repository status (warns about uncommitted changes)

3. **Clear Communication**
   - Shows detailed similarity analysis with file-by-file breakdown
   - Lists specific missing and extra files for better understanding
   - Explains exactly which migration point was detected as best match
   - Displays how many migrations will be marked as applied vs available
   - Provides clear next steps: "Run 'template-cli update' to apply X pending migrations"
   - Requires explicit user confirmation before making any changes

## Benefits

This historical reconstruction approach:
- Automatically finds the right starting point for migration tracking
- Preserves all user customizations
- Integrates seamlessly with existing update mechanism
- Provides clear visibility into the sync process
- Minimizes manual intervention and guesswork