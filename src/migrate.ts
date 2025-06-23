// Re-export types for external use
export type { DiffChange } from "./utils/diff-utils.js";
export type {
  MigrationEntry,
  Migration,
  MigrationFile,
  AppliedMigration,
  AppliedMigrationsFile,
} from "./utils/migration-utils.js";

// Export internal functions for testing
export {
  matchesGitignorePattern,
  shouldIgnoreFile,
} from "./utils/file-utils.js";
export { calculateLineDiffs } from "./utils/diff-utils.js";
export { generateMigration } from "./commands/generate.js";
