# Template Update CLI Specification

## Overview

The Template Update CLI is a development tool that generates migration files based on state differences and can initialize projects from templates. It tracks changes to a project over time and creates structured migration files that can be applied to other projects.

## Architecture

### Core Concepts

1. **Migration**: A structured representation of changes between two states of a project
2. **State**: A snapshot of all files and their contents at a specific point in time
3. **Template**: A base project structure that can be used to initialize new projects
4. **Applied Migrations**: A record of which migrations have been applied to a project

### Project Structure

```
src/
├── __tests__/              # Test files
├── commands/               # Command implementations
│   ├── generate.ts         # Migration generation command
│   └── init.ts            # Template initialization command
├── utils/                  # Shared utilities
│   ├── diff-utils.ts       # Line-by-line diff calculations
│   ├── difference-utils.ts # Migration difference detection
│   ├── file-utils.ts       # File system operations
│   ├── migration-utils.ts  # Migration file handling
│   ├── state-utils.ts      # State reconstruction
│   └── template-utils.ts   # Template operations
└── migrate.ts              # Main export file
```

## Commands

### 1. Generate Command

**Usage**: `bun run dev dev generate [name] [-p, --path <path>]`

**Purpose**: Generate migration files based on differences between the current project state and the last known state from previous migrations.

#### Process Flow

1. **Initialize**: Create `migrations/` directory if it doesn't exist
2. **Load Ignore Patterns**: Read `.migrateignore` file or use defaults
3. **Reconstruct Previous State**: Apply all existing migrations in chronological order to reconstruct the last known state
4. **Scan Current State**: Read all files in the project (excluding ignored patterns)
5. **Calculate Differences**: Compare reconstructed state vs current state
6. **Handle User Interaction**: For deleted files, prompt user to determine if they were moved/renamed
7. **Generate Migration**: Create timestamped migration folder with changes
8. **Save Template Files**: Store content of new files as `.template` files

#### Migration Types

- **New Files**: `{ type: "new", path: "file.txt" }`
- **Modified Files**: `{ type: "modify", diffs: [...] }`
- **Deleted Files**: `{ type: "delete", path: "file.txt" }`
- **Moved Files**: `{ type: "moved", oldPath: "old.txt", newPath: "new.txt", diffs?: [...] }`

#### Migration Structure

```
migrations/
└── YYYY-MM-DDTHH-mm-ss_migration-name/
    ├── migrate.ts          # Migration definition
    └── __files/            # Template files for new files
        └── path/
            └── file.txt.template
```

#### Migration File Format

```typescript
export const migration = {
  "new-file.txt": {
    "type": "new",
    "path": "new-file.txt"
  },
  "modified-file.txt": {
    "type": "modify",
    "diffs": [
      {
        "operation": "replace",
        "startLine": 1,
        "endLine": 1,
        "oldContent": "old content",
        "newContent": "new content"
      }
    ]
  }
} as const;
```

### 2. Init Command

**Usage**: `bun run dev dev init <target> [-t, --template <path>]`

**Purpose**: Initialize a new project from a template, applying all migrations if they exist.

#### Process Flow

1. **Validate Template**: Ensure template directory exists and is readable
2. **Check for Migrations**: Determine if template has a `migrations/` directory
3. **Validate Target**: Ensure target directory doesn't exist or is empty
4. **User Confirmation**: Prompt user to confirm initialization
5. **Apply Migrations or Copy**: Either apply all migrations in order or copy template directly
6. **Create Applied Migrations File**: Track which migrations have been applied

#### With Migrations

When a template has migrations:
1. Apply each migration in chronological order
2. Track applied migrations in `applied-migrations.json`
3. Build final project state incrementally

#### Without Migrations

When no migrations exist:
1. Copy all template files (excluding `.git`, `migrations/`, etc.)
2. Create empty `applied-migrations.json`

## File Handling

### Ignore Patterns

The tool respects `.migrateignore` files using gitignore-style patterns:

**Default Patterns**:
```
migrations/**
.git/**
node_modules/**
.DS_Store
*.log
.env*
.migrateignore
bun.lock
.claude/**
```

**Pattern Matching**:
- `*` matches any characters except `/`
- `**` matches any characters including `/`
- `!pattern` negates a pattern
- `pattern/` matches directories only
- Patterns without leading `/` match at any level

### State Reconstruction

The tool reconstructs previous state by applying migrations chronologically:

1. **Load Migration Files**: Read all `migrate.ts` files in timestamp order
2. **Parse Migration Objects**: Extract migration definitions using `eval()` (safe since we control the format)
3. **Apply Changes**: For each migration entry:
   - **New**: Load content from `.template` file
   - **Delete**: Remove file from state
   - **Modify**: Apply line-by-line diffs
   - **Moved**: Move content and apply diffs if present

### Diff Algorithm

Line-by-line diff calculation:

1. **Split Content**: Convert old and new content to line arrays
2. **Compare Lines**: Use simple heuristic algorithm
3. **Generate Operations**:
   - **Replace**: When lines differ and next lines match
   - **Insert**: When new content has additional lines
   - **Delete**: When old content has removed lines
4. **Output Format**: Array of `DiffChange` objects with operation, line numbers, and content

### Diff Application

When applying diffs to reconstruct state:

1. **Sort Diffs**: Apply in reverse line order to maintain line numbers
2. **Apply Operations**:
   - **Replace**: Remove old lines and insert new content
   - **Insert**: Add new lines at specified position
   - **Delete**: Remove specified lines
3. **Join Lines**: Reconstruct file content from modified line array

## Data Structures

### Migration Entry
```typescript
interface MigrationEntry {
  type: 'new' | 'delete' | 'modify' | 'moved';
  path?: string;
  oldPath?: string;  // for moved files
  newPath?: string;  // for moved files
  diffs?: DiffChange[];
}
```

### Diff Change
```typescript
interface DiffChange {
  operation: 'replace' | 'insert' | 'delete';
  startLine: number;
  endLine?: number;        // for replace/delete operations
  afterLine?: number;      // for insert operations
  oldContent?: string;     // content being replaced/deleted
  newContent?: string;     // content being inserted/replacement
}
```

### Applied Migrations File
```typescript
interface AppliedMigrationsFile {
  version: string;
  template: string;
  appliedMigrations: AppliedMigration[];
}

interface AppliedMigration {
  name: string;
  appliedAt: string;
}
```

## Error Handling

### Generation Errors
- **No Changes**: Shows message and exits gracefully
- **File Read Errors**: Skips binary/unreadable files
- **Migration Parse Errors**: Warns and skips malformed migrations

### Initialization Errors
- **Template Not Found**: Throws error with clear message
- **Target Not Empty**: Throws error to prevent accidental overwrites
- **Permission Errors**: Propagates filesystem errors

## User Interaction

### Move Detection
When files are deleted, the tool prompts:
1. **Confirmation**: "Was this file moved/renamed?"
2. **Selection**: Choose which new file it was moved to
3. **Diff Calculation**: Calculate changes if content differs

### Initialization Confirmation
Before initializing from template:
- Shows template name and target path
- Asks for user confirmation
- Allows cancellation

## Testing

### Test Structure
- **Unit Tests**: Individual function testing
- **Integration Tests**: End-to-end migration generation and application
- **Test Utilities**: Helper functions for creating test repositories

### Test Coverage
- Pattern matching and ignore file handling
- Diff calculation and application
- Migration generation with all change types
- Template initialization with and without migrations
- Error conditions and edge cases

## Performance Considerations

### File Scanning
- Uses Node.js `fs.readdir` with `withFileTypes` for efficient directory traversal
- Applies ignore patterns early to avoid unnecessary file reads
- Handles binary files gracefully by catching read errors

### Memory Usage
- Processes files individually rather than loading entire project into memory
- Uses streaming operations where possible
- Limits eval usage to controlled migration file parsing

### Scalability
- Chronological migration ordering ensures deterministic state reconstruction
- Migration folder structure allows for thousands of migrations
- Ignore patterns prevent scanning of large directories like `node_modules`

## Security

### Safe Eval Usage
- Migration files use `eval()` only on controlled, generated content
- Migration format is JSON-compatible with consistent structure
- Error handling prevents malicious migration files from causing crashes

### File System Safety
- Validates paths to prevent directory traversal
- Checks permissions before file operations
- Uses safe file operations with proper error handling

## Extensibility

### Adding New Migration Types
1. Extend `MigrationEntry` interface
2. Add handling in state reconstruction
3. Add handling in migration application
4. Update diff calculation if needed

### Custom Ignore Patterns
- Users can modify `.migrateignore` for project-specific needs
- Supports standard gitignore syntax
- Includes negation patterns for fine-grained control

### Integration Points
- Clean API for programmatic usage
- Separate command modules for easy extension
- Utility modules can be reused in other tools