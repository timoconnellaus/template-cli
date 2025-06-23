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
│   ├── generate.ts         # Migration generation command (for template developers)
│   ├── init.ts            # Template initialization command (for template users)
│   ├── check.ts           # Check pending migrations command (for template users)
│   └── update.ts          # Apply pending migrations command (for template users)
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

The CLI provides two categories of commands:

- **Template User Commands** (top-level): For developers using templates to initialize and update projects
- **Template Developer Commands** (under `dev`): For template maintainers creating and managing templates

### Template User Commands

#### 1. Init Command

**Usage**: `bun run dev init <target> [-t, --template <path>]`

**Purpose**: Initialize a new project from a template, applying all migrations if they exist.

#### 2. Check Command

**Usage**: `bun run dev check [-p, --path <path>]`

**Purpose**: Check for pending migrations from the template that haven't been applied to the current project.

**Process Flow**:
1. **Read Applied Migrations**: Load `applied-migrations.json` to get template path and applied migration history
2. **Scan Template**: Get all available migrations from the template's `migrations/` directory
3. **Compare**: Identify migrations that exist in template but not in applied history
4. **Report**: Display pending migrations with timestamps and names
5. **Git Check**: Optionally check if template repository has newer commits

#### 3. Update Command

**Usage**: `bun run dev update [-p, --path <path>]`

**Purpose**: Apply pending migrations from the template to the current project.

**Process Flow**:
1. **Read Applied Migrations**: Load `applied-migrations.json` to get template path and applied migration history
2. **Find Pending**: Identify migrations that haven't been applied yet
3. **Apply Sequentially**: Apply each pending migration in chronological order
4. **Update Tracking**: Add newly applied migrations to `applied-migrations.json`
5. **Error Handling**: Stop on first error to maintain consistency
6. **Git Status**: Show changed files after successful application

### Template Developer Commands

#### 1. Generate Command

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

## Command Workflow

### Template Developer Workflow
1. **Create/Modify Template**: Make changes to the template project
2. **Generate Migration**: Run `bun run dev dev generate <name>` to create migration files
3. **Commit Changes**: Commit both the changes and generated migrations to version control

### Template User Workflow
1. **Initialize Project**: Run `bun run dev init <project-name>` to create new project from template
2. **Check for Updates**: Periodically run `bun run dev check` to see if template has new migrations
3. **Apply Updates**: Run `bun run dev update` to apply pending migrations to the project
4. **Review Changes**: Check git status and review applied changes before committing

### Applied Migrations Tracking

The `applied-migrations.json` file tracks:
- **Template Source**: Path to the original template
- **Migration History**: List of applied migrations with timestamps
- **Version**: File format version for future compatibility

Example:
```json
{
  "version": "1.0.0",
  "template": "/path/to/template",
  "appliedMigrations": [
    {
      "name": "2025-06-23T10-30-00_initial-setup",
      "timestamp": "2025-06-23T10-30-00",
      "appliedAt": "2025-06-23T15:45:00.000Z"
    }
  ]
}
```

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
  timestamp: string;
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

### Check/Update Errors
- **Missing Applied Migrations File**: Clear error message directing user to run `init` first
- **Invalid Template Path**: Error when template referenced in `applied-migrations.json` doesn't exist
- **Migration Application Failure**: Stops on first error, maintains consistency by updating tracking file incrementally
- **Git Repository Issues**: Gracefully handles non-git repositories or git errors

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

The test suite is organized into focused test files:

**Utility Tests** (`src/__tests__/utils/`):
- `file-utils.test.ts` - Pattern matching and file filtering
- `diff-utils.test.ts` - Line diff calculations
- `state-utils.test.ts` - Migration directory handling and state reconstruction
- `migration-utils.test.ts` - Migration parsing and writing
- `template-utils.test.ts` - Template copying and migration application
- `difference-utils.test.ts` - State difference detection

**Command Tests** (`src/__tests__/commands/`):
- `generate.test.ts` - Migration generation functionality
- `init.test.ts` - Project initialization from templates
- `check.test.ts` - Checking pending migrations
- `update.test.ts` - Applying pending migrations

### Test Coverage
- Pattern matching and ignore file handling
- Diff calculation and application
- Migration generation with all change types
- Template initialization with and without migrations
- Checking for and applying pending migrations
- Error conditions and edge cases
- Interactive prompt mocking for non-interactive testing
- File system operations and git integration

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