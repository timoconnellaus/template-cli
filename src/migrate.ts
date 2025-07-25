// Re-export types for external use
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
export { generateMigration } from "./commands/generate.js";
