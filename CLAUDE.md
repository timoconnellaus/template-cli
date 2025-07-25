# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

### For Template Users:

- **Initialize**: `bun run dev init <target>` - Initialize a new project from template
- **Check Updates**: `bun run dev check` - Check for pending migrations from template
- **Apply Updates**: `bun run dev update` - Apply pending migrations from template

### For Template Developers:

- **Generate Migration**: `bun run dev dev generate [name]` - Generate migration from current state vs last migration

### Development:

- **Build**: `bun run build` - Build to dist/ folder for production
- **Test**: `bun run test` - Run Vitest test suite (NOT `bun test` which runs Bun's built-in runner)
- **Test Watch**: `bun run test:watch` - Run tests in watch mode

## Architecture Overview

This is a CLI tool for generating migration files based on state differences. The main components:

- **CLI Entry Point** (`index.ts`): Commander.js-based CLI with user commands (`init`, `check`, `update`) and developer commands (`dev generate`)
- **Migration Engine** (`src/migrate.ts`): Core logic that compares current state vs reconstructed state from existing migrations
- **Output**: Creates `migrations/` directory with timestamped folders containing `migrate.ts` files

### Migration Generation Process

1. Reconstructs current state by applying all existing migrations in chronological order
2. Scans actual filesystem to get current state (respecting `.migrateignore` patterns)
3. Calculates differences between reconstructed state and actual state
4. If changes exist, creates new migration folder with format: `YYYY-MM-DDTHH-mm-ss_name`
5. Generates TypeScript files with file changes:
   - New files: `{ type: "new", path: "..." }` + content in `__files/path.template`
   - Modified files: `{ type: "modify", diffFile: "path.diff" }` with unified diff files
   - Deleted files: `{ type: "delete", path: "..." }`
6. If no changes detected, shows message and doesn't create migration

### Conflict Resolution

When applying migrations, if a diff cannot be applied (due to local changes conflicting with template changes), the system provides interactive conflict resolution:

1. **Shows the conflict**: Displays current file content and the failed diff
2. **Interactive choice**: Prompts user to choose:
   - "Keep my version" - Preserves the current file content
   - "Use template" - Attempts to apply the template changes forcefully
3. **Continues migration**: After resolving the conflict, continues with remaining files

## TypeScript Best Practices

- Use proper type imports: `import { simpleGit, type SimpleGit } from 'simple-git'`
- Check type errors after changes using IDE diagnostics

## Testing

- Uses Vitest with Bun runtime
- `bun run test` runs Vitest (NOT `bun test` which runs Bun's built-in runner)
- Tests have 30-second timeout for git operations
- Test utilities in `src/test-helpers.ts`

## Documentation References

- The @SPEC.md file contains details about how the CLI works in depth and should be consulted first before making changes
- Before committing any code - the SPEC.md file must be updated to ensure it's consistent with the functionality of the CLI
