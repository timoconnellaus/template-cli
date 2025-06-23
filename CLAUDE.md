# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

- **Development**: `bun run dev` - Run the CLI in development mode
- **Build**: `bun run build` - Build to dist/ folder for production
- **Test**: `bun run test` - Run Vitest test suite (NOT `bun test` which runs Bun's built-in runner)
- **Test Watch**: `bun run test:watch` - Run tests in watch mode

## Architecture Overview

This is a CLI tool for generating migration files from git commits. The main components:

- **CLI Entry Point** (`index.ts`): Commander.js-based CLI with `dev migrate` command
- **Migration Engine** (`src/migrate.ts`): Core logic that analyzes git history and generates TypeScript migration files
- **Output**: Creates `migrations/` directory with numbered folders containing `migrate.ts` files

### Migration Generation Process

1. Analyzes git log to get all commits chronologically
2. For each commit, creates a migration folder (`01_latest`, `02_abc12345`, etc.)
3. Generates TypeScript files with file changes:
   - New files: Full content as template literals
   - Modified files: Diff lines as arrays
   - Deleted files: `{ deleted: true }` markers
4. Respects `.migrateignore` patterns (or defaults: migrations/**, node_modules/**, etc.)

## TypeScript Best Practices

- Use proper type imports: `import { simpleGit, type SimpleGit } from 'simple-git'`
- Check type errors after changes using IDE diagnostics

## Testing

- Uses Vitest with Bun runtime
- `bun run test` runs Vitest (NOT `bun test` which runs Bun's built-in runner)
- Tests have 30-second timeout for git operations
- Test utilities in `src/test-helpers.ts`