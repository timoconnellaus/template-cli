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
   - Scan the user's repository (respecting both `.gitignore` and `.migrateignore`)
   - Create a snapshot of current file structure and contents

4. **Similarity Matching**
   - Compare user's repository against each historical template state
   - Score each comparison using comprehensive similarity algorithm
   - Identify the best matching migration point using `findBestMatch()`
   - Display detailed list of missing and extra files for each match

5. **Interactive File Handling**
   - **Missing Files**: Step through each missing file individually
     - Show file preview and ask user to "Add" or "Skip" each one
   - **Similar Files**: Handle files with differences interactively
     - Ask user to "Replace", "Skip", or "Use Claude Code to merge" each one
     - Claude Code integration provides intelligent merging when requested

6. **User Confirmation**
   - Display detailed similarity analysis results
   - Show which migrations would be marked as applied
   - Show how many newer migrations would be available
   - Require explicit user confirmation before proceeding

7. **Tracking Establishment**
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
- **High similarity partial match**: +5 points (≥80% line-by-line similarity)
- **Low similarity partial match**: +1 point (file exists but <80% similar)
- **Missing expected file**: -3 points (template has file, user doesn't)
- **Extra file in user repo**: -1 point (user has file, template doesn't)
- **Matching directory structure**: +2 points per matching directory

**Note:** Files that exist in both repositories are always classified as either "exact matches" or "partial matches" regardless of similarity level. Only files that exist in the template but not in the user's repository are classified as "missing".

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

📋 Found 1 missing files from the template:

📄 Missing file: auth/middleware.js
Content:
module.exports = {
  authenticateUser: (req, res, next) => {
    // Auth logic here
    next();
  }
};

❓ What would you like to do with auth/middleware.js?
❯ Add this file to my repository
  Skip this file

🔄 Found 0 files with differences.

🔄 After synchronization:
   - 5 newer migrations will be available to apply

❓ Proceed with synchronization? This will:
   1. Create applied-migrations.json marking this sync point
   2. Make 5 migration(s) available for update
   
Continue? No

❌ Synchronization cancelled.
```

**Successful Sync with Interactive Choices:**
```
$ template-cli sync --template ../my-template

🔍 Analyzing your repository...
📊 Calculating similarity scores...

✅ Best match found: "2025-06-20T10-00-00_add-auth-system"

📋 Found 1 missing files from the template:

📄 Missing file: auth/middleware.js
Content:
module.exports = { authenticateUser: (req, res, next) => next(); };

❓ What would you like to do with auth/middleware.js?
❯ Add this file to my repository

✅ Added auth/middleware.js

🔄 Found 1 files with differences:

📝 File with differences: package.json

📊 Differences detected:
Your version: 15 lines
Template version: 18 lines

❓ How would you like to handle package.json?
❯ Use Claude Code to intelligently merge both versions

🤖 Claude Code merged package.json

❓ Proceed with synchronization? Continue? Yes

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
  
  // 3. Analyze user repository (respects both .gitignore and .migrateignore)
  const userState = await getCurrentState(targetPath, ignorePatterns);
  
  // 4. Calculate similarity scores for each historical state
  const scores: SimilarityScore[] = [];
  for (const [stateName, templateState] of historicalStates) {
    const score = calculateSimilarity(userState, templateState, stateName, timestamp);
    scores.push(score);
  }
  
  // 5. Find best match
  const bestMatch = findBestMatch(scores);
  
  // 6. Interactive file handling
  await handleMissingFiles(bestMatch, historicalStates, targetPath, templatePath);
  await handleSimilarFiles(bestMatch, historicalStates, userState, targetPath, templatePath);
  
  // 7. User confirmation
  const shouldProceed = await confirm({ message: "Continue?", default: false });
  
  // 8. Create applied-migrations.json
  if (shouldProceed) {
    const appliedMigrations = createAppliedMigrationsFile(templatePath, bestMatch);
    writeFileSync(appliedMigrationsPath, JSON.stringify(appliedMigrations, null, 2));
  }
}
```

**Key Implementation Features:**

1. **Incremental Reconstruction**: Uses `reconstructStateIncrementally()` instead of `reconstructStateFromMigrations()` for accurate historical state building

2. **Interactive File Management**: 
   - `handleMissingFiles()`: Steps through missing files individually for user choice
   - `handleSimilarFiles()`: Handles files with differences interactively
   - Claude Code integration for intelligent merging when requested

3. **Comprehensive Validation**: Checks for existing tracking, template validity, and empty repositories

4. **Performance Optimized**: Handles large template histories efficiently (25+ migrations in <10s)

5. **User-Centric**: Requires explicit confirmation and provides clear next steps

### 7. Technical Considerations

1. **State Reconstruction**
   - Uses `reconstructStateIncrementally()` for proper historical state building
   - Each historical state is reconstructed by applying migrations sequentially
   - Optimized for large template histories (handles 25+ migrations efficiently)
   - Memory-efficient incremental reconstruction vs full state reconstruction

2. **Similarity Calculation**
   - Hash-based comparison for exact file content matches
   - Line-by-line similarity analysis for partial matches (≥80% threshold for high similarity)
   - Files existing in both repos but <80% similar are still treated as partial matches (low similarity)
   - Directory structure scoring for organizational similarity
   - Weighted scoring system balances precision vs recall
   - **Fixed:** Files that exist in both repositories are never classified as "missing"

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

## Ignore Pattern Handling

The system now properly handles both `.gitignore` and `.migrateignore` patterns:

### Pattern Loading Priority
1. **Default patterns**: Built-in exclusions (migrations/, .git/, node_modules/, etc.)
2. **`.gitignore` patterns**: Loaded from project's `.gitignore` file if it exists
3. **`.migrateignore` patterns**: Loaded from project's `.migrateignore` file if it exists

### Override Behavior
- `.migrateignore` patterns can override `.gitignore` patterns using negation (`!pattern`)
- Example: If `.gitignore` contains `.env*`, but `.migrateignore` contains `!.env.example`, then `.env.example` will be included in migrations while other `.env*` files remain excluded

### Migration Generation
When generating migrations with `bun run dev generate`, files matching either `.gitignore` or `.migrateignore` patterns are excluded from the migration, ensuring that sensitive or build-generated files don't accidentally get included in template updates.

## Benefits

This historical reconstruction approach:
- Automatically finds the right starting point for migration tracking
- Preserves all user customizations
- Integrates seamlessly with existing update mechanism
- Provides clear visibility into the sync process
- Minimizes manual intervention and guesswork
- Respects both `.gitignore` and `.migrateignore` patterns to prevent unwanted files in migrations

## Binary File Handling

### Overview
The sync and update system now properly handles binary files, which cannot be merged automatically like text files. Binary files are detected using content analysis and handled with simple "replace or keep" logic.

### Binary File Detection
Files are automatically detected as binary if they:
- Contain null bytes (common binary indicator)
- Have more than 30% non-printable characters (excluding common whitespace)

### Migration Generation with Binary Files
When generating migrations:
- Binary files are stored as `.binary` files in the migration's `__files` directory
- Binary operations are tracked as `type: 'binary'` entries in migration files
- Binary files cannot be diffed, so changes are always treated as full replacements

### Conflict Resolution for Binary Files
During sync or update operations, binary file conflicts are handled with simplified options:

```
🔧 Binary File Conflict Detected
==================================================
File: assets/logo.png
Binary files cannot be merged automatically.
==================================================

💡 How would you like to handle the binary file assets/logo.png?
1. Keep my version (current file)
2. Replace with template version

Enter your choice (1 or 2):
```

**Key differences from text file conflicts:**
- No "Claude Code merge" option (binary files cannot be merged)
- Simple two-choice interface: keep current or replace with template
- Clear messaging that binary files cannot be merged automatically

### Technical Implementation
- **Detection**: `isBinaryFile()` function in `file-utils.ts`
- **State Tracking**: `getCurrentStateWithBinary()` separates text and binary files
- **Migration Types**: Extended with `binary` type and `isBinary` flag
- **Conflict Resolution**: Simplified interactive prompts for binary files
- **State Reconstruction**: Binary files tracked through migration history

### Benefits
- **Clear Separation**: Binary and text files handled appropriately for their type
- **User-Friendly**: Simple conflict resolution for binary files
- **Robust Detection**: Accurate binary file identification
- **Preserved Functionality**: All existing text file merging capabilities maintained

## Recent Updates

### v1.5.4 - Binary File Support (Current)
**Feature:** Added comprehensive binary file handling for sync and update operations.

**New Capabilities:**
- **Automatic Binary Detection**: Files are automatically detected as binary using content analysis
- **Simplified Conflict Resolution**: Binary files get "keep or replace" options instead of merge attempts
- **Enhanced Migration System**: Binary files stored as `.binary` files in migrations
- **Robust State Tracking**: Separate handling of text vs binary files throughout the system

**Technical Implementation:**
- Added `isBinaryFile()` detection function using null byte and non-printable character analysis
- Extended migration data structures with `binary` type and `isBinary` flag
- Created binary-aware state reconstruction and difference calculation
- Implemented interactive binary file conflict resolution
- Added comprehensive test coverage for binary file operations

**User Experience:**
- Clear messaging when binary files cannot be merged automatically
- Simple two-choice prompts: "Keep my version" or "Replace with template version"
- All existing text file merging capabilities preserved and enhanced

### v1.4.2 - Enhanced Claude CLI Performance
**Issue:** Claude CLI timeout was too short (60 seconds) for complex merges like package.json, and users had no visibility into processing progress during long operations.

**Improvements:**
- **Extended Timeout**: Increased Claude CLI timeout from 60 seconds to 5 minutes (300,000ms) to handle complex merges
- **Progress Feedback**: Added real-time step counter showing Claude CLI processing steps (e.g., "Running Claude Code CLI... (12 steps)")
- **Better User Experience**: Users can now see that progress is being made during long-running merge operations

**Technical Changes:**
- Modified `src/utils/claude-cli.ts` to track and display processing steps from Claude CLI JSON stream
- Updated timeout error message to reflect new 5-minute limit
- Added step counting for `tool_use`, `tool_result`, `thinking`, and `content` message types

**Benefits:**
- Prevents premature timeouts on complex files like package.json
- Provides user confidence that processing is actively occurring
- Better handles large file merges and complex conflict resolution scenarios

### v1.4.1 - Refactored Claude CLI Integration
**Issue:** The conflict resolution system was tightly coupled, with Claude CLI calling logic mixed with user prompts, making it difficult to maintain and test.

**Refactoring:**
- **Isolated Claude CLI Function**: Created `src/utils/claude-cli.ts` with dedicated `callClaudeToMergeFile()` function
- **Direct Prompts**: Moved conflict resolution prompts directly into sync and update commands instead of shared utility
- **Cleaner Architecture**: Each command now controls its own user interaction flow
- **Improved Testing**: Fixed hanging tests by properly mocking `@inquirer/prompts.select` instead of readline

**Benefits:**
- Better separation of concerns between Claude CLI calling and user prompts
- More maintainable code with explicit conflict resolution flows
- Easier testing with isolated functions
- All 148 tests now pass consistently

### v1.4.0 - Simplified Sync Display
**Issue:** Sync command was showing excessive information about all migration comparison results, making the output cluttered and hard to read.

**Improvements:**
- **Focused Display**: Now shows only the best match migration details instead of all comparisons
- **Essential Information**: Displays only the most relevant file lists (missing, partial matches, extra files)
- **Cleaner UI**: Removed verbose similarity scoring details from main output
- **Better UX**: Users can quickly understand the sync results without information overload

**Result:** Much cleaner and more actionable sync command output that focuses on what users need to know.

### v1.2.1 - Fixed File Classification Bug
**Issue:** Files that existed in both repositories but had different content were incorrectly classified as "missing" instead of "partial matches" when similarity was below 80%.

**Example:** A `biome.json` file present in both template and user repo but with different configurations would show as "missing" rather than requiring merge resolution.

**Fix:** Updated similarity calculation logic in `src/utils/similarity-utils.ts` to:
- Always classify files that exist in both repositories as "partial matches" regardless of similarity level
- Only classify files as "missing" when they exist in template but not in user repository
- Low similarity files (< 80%) now receive +1 point instead of -3 penalty
- Ensures proper interactive handling through merge/replace/skip workflow