// Re-export types for external use
export type {
  MigrationEntry,
  Migration,
  MigrationFile,
  AppliedMigration,
  AppliedMigrationsFile,
  SkippedMigration,
} from "./utils/migration-utils.js";

// Re-export feature types
export type {
  FeatureManifest,
  FeatureEntry,
  InjectionPoint,
  ProjectConfig,
} from "./utils/feature-utils.js";

export type {
  FeatureStateChange,
  FeatureState,
} from "./utils/feature-state-utils.js";

export type {
  FeatureMigrationEntry,
  FeatureMigration,
} from "./utils/feature-migration-utils.js";

// Export internal functions for testing
export {
  matchesGitignorePattern,
  shouldIgnoreFile,
} from "./utils/file-utils.js";
export { generateMigration } from "./commands/generate.js";

// Export feature utilities
export {
  parseFeatureManifest,
  validateFeatureManifest,
  readProjectConfig,
  writeProjectConfig,
  isFileFeatureExclusive,
  getFileFeatures,
  validateFeatureDependenciesForEnabledSet,
  resolveDependenciesForFeatures,
  canDisableFeature,
} from "./utils/feature-utils.js";

export {
  getCurrentFeatureState,
  enableFeature,
  disableFeature,
  setEnabledFeatures,
  getFeatureDifference,
  updateFeatureFileTracking,
  isFeatureEnabled,
  areFeatureDependenciesSatisfied,
  syncFeatureStateWithConfig,
} from "./utils/feature-state-utils.js";

export {
  shouldApplyMigrationEntry,
  filterMigrationByFeatures,
  detectFeatureAssociations,
  createFeatureMigrationEntry,
  getFeatureSpecificDiff,
  readFeatureMigrationFromPath,
  writeFeatureMigrationFile,
  getMigrationFeatureRequirements,
  canApplyMigration,
  extractFeatureFilesFromMigration,
  isFeatureContentBlock,
  isInjectionPoint,
  processFeatureConditionalContent,
} from "./utils/feature-migration-utils.js";
