import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp } from 'fs/promises';
import {
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
  type FeatureMigrationEntry,
  type FeatureMigration,
} from '../../utils/feature-migration-utils.js';
import { type FeatureManifest } from '../../utils/feature-utils.js';

describe('feature-migration-utils', () => {
  let tempDir: string;
  let manifest: FeatureManifest;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'feature-migration-test-'));
    
    manifest = {
      version: '1.0.0',
      features: {
        auth: {
          description: 'Authentication',
          exclusivePatterns: ['src/auth/**']
        },
        organizations: {
          description: 'Organizations',
          dependencies: ['auth'],
          exclusivePatterns: ['src/orgs/**']
        }
      }
    };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('shouldApplyMigrationEntry', () => {
    it('should apply entry without feature requirements', () => {
      const entry: FeatureMigrationEntry = {
        type: 'new',
        path: 'src/utils/helper.ts'
      };

      expect(shouldApplyMigrationEntry(entry, ['auth'])).toBe(true);
      expect(shouldApplyMigrationEntry(entry, [])).toBe(true);
    });

    it('should apply feature-exclusive entry when feature is enabled', () => {
      const entry: FeatureMigrationEntry = {
        type: 'new',
        path: 'src/auth/login.ts',
        featureExclusive: 'auth'
      };

      expect(shouldApplyMigrationEntry(entry, ['auth'])).toBe(true);
    });

    it('should not apply feature-exclusive entry when feature is disabled', () => {
      const entry: FeatureMigrationEntry = {
        type: 'new',
        path: 'src/auth/login.ts',
        featureExclusive: 'auth'
      };

      expect(shouldApplyMigrationEntry(entry, [])).toBe(false);
      expect(shouldApplyMigrationEntry(entry, ['organizations'])).toBe(false);
    });

    it('should apply entry with feature-specific diffs when feature is enabled', () => {
      const entry: FeatureMigrationEntry = {
        type: 'modify',
        path: 'src/routes.ts',
        features: {
          auth: 'routes-auth.diff',
          organizations: 'routes-orgs.diff'
        }
      };

      expect(shouldApplyMigrationEntry(entry, ['auth'])).toBe(true);
      expect(shouldApplyMigrationEntry(entry, ['organizations'])).toBe(true);
      expect(shouldApplyMigrationEntry(entry, ['auth', 'organizations'])).toBe(true);
    });

    it('should apply entry with _base diff when no specific features are enabled', () => {
      const entry: FeatureMigrationEntry = {
        type: 'modify',
        path: 'src/routes.ts',
        features: {
          auth: 'routes-auth.diff',
          _base: 'routes-base.diff'
        }
      };

      expect(shouldApplyMigrationEntry(entry, [])).toBe(true);
      expect(shouldApplyMigrationEntry(entry, ['other'])).toBe(true);
    });

    it('should not apply entry with only feature-specific diffs when no features are enabled', () => {
      const entry: FeatureMigrationEntry = {
        type: 'modify',
        path: 'src/routes.ts',
        features: {
          auth: 'routes-auth.diff',
          organizations: 'routes-orgs.diff'
        }
      };

      expect(shouldApplyMigrationEntry(entry, [])).toBe(false);
      expect(shouldApplyMigrationEntry(entry, ['other'])).toBe(false);
    });
  });

  describe('filterMigrationByFeatures', () => {
    const migration: FeatureMigration = {
      'src/auth/login.ts': {
        type: 'new',
        path: 'src/auth/login.ts',
        featureExclusive: 'auth'
      },
      'src/orgs/create.ts': {
        type: 'new',
        path: 'src/orgs/create.ts',
        featureExclusive: 'organizations'
      },
      'src/routes.ts': {
        type: 'modify',
        path: 'src/routes.ts',
        features: {
          auth: 'routes-auth.diff',
          _base: 'routes-base.diff'
        }
      },
      'src/utils/helper.ts': {
        type: 'new',
        path: 'src/utils/helper.ts'
      }
    };

    it('should filter migration based on enabled features', () => {
      const { applicableMigration, skippedEntries } = filterMigrationByFeatures(migration, ['auth']);

      expect(Object.keys(applicableMigration)).toEqual([
        'src/auth/login.ts',
        'src/routes.ts',
        'src/utils/helper.ts'
      ]);

      expect(skippedEntries).toEqual([
        { key: 'src/orgs/create.ts', reason: 'feature:organizations not enabled' }
      ]);
    });

    it('should apply all entries when all features are enabled', () => {
      const { applicableMigration, skippedEntries } = filterMigrationByFeatures(migration, ['auth', 'organizations']);

      expect(Object.keys(applicableMigration)).toEqual(Object.keys(migration));
      expect(skippedEntries).toEqual([]);
    });

    it('should skip feature-exclusive entries when no features are enabled', () => {
      const { applicableMigration, skippedEntries } = filterMigrationByFeatures(migration, []);

      expect(Object.keys(applicableMigration)).toEqual([
        'src/routes.ts', // has _base diff
        'src/utils/helper.ts' // no feature requirements
      ]);

      expect(skippedEntries).toHaveLength(2);
    });
  });

  describe('detectFeatureAssociations', () => {
    it('should detect feature associations based on patterns', () => {
      expect(detectFeatureAssociations('src/auth/login.ts', manifest)).toEqual(['auth']);
      expect(detectFeatureAssociations('src/orgs/create.ts', manifest)).toEqual(['organizations']);
    });

    it('should return empty array for non-matching files', () => {
      expect(detectFeatureAssociations('src/utils/helper.ts', manifest)).toEqual([]);
    });

    it('should handle null manifest', () => {
      expect(detectFeatureAssociations('src/auth/login.ts', null)).toEqual([]);
    });
  });

  describe('createFeatureMigrationEntry', () => {
    it('should create entry with feature-exclusive for single feature match', () => {
      const entry = createFeatureMigrationEntry('new', 'src/auth/login.ts', manifest);

      expect(entry).toEqual({
        type: 'new',
        path: 'src/auth/login.ts',
        featureExclusive: 'auth'
      });
    });

    it('should create entry without feature properties for non-matching file', () => {
      const entry = createFeatureMigrationEntry('new', 'src/utils/helper.ts', manifest);

      expect(entry).toEqual({
        type: 'new',
        path: 'src/utils/helper.ts'
      });
    });

    it('should include additional properties', () => {
      const entry = createFeatureMigrationEntry('modify', 'src/auth/login.ts', manifest, {
        diffFile: 'login.diff'
      });

      expect(entry).toEqual({
        type: 'modify',
        path: 'src/auth/login.ts',
        featureExclusive: 'auth',
        diffFile: 'login.diff'
      });
    });

    it('should handle multiple feature associations', () => {
      const multiFeatureManifest: FeatureManifest = {
        version: '1.0.0',
        features: {
          auth: {
            description: 'Auth',
            exclusivePatterns: ['src/shared/**']
          },
          organizations: {
            description: 'Orgs',
            exclusivePatterns: ['src/shared/**']
          }
        }
      };

      const entry = createFeatureMigrationEntry('modify', 'src/shared/utils.ts', multiFeatureManifest, {
        diffFile: 'utils.diff'
      });

      expect(entry.features).toEqual({
        auth: 'utils.diff',
        organizations: 'utils.diff'
      });
    });
  });

  describe('getFeatureSpecificDiff', () => {
    it('should return regular diff file when no features specified', () => {
      const entry: FeatureMigrationEntry = {
        type: 'modify',
        path: 'src/utils.ts',
        diffFile: 'utils.diff'
      };

      expect(getFeatureSpecificDiff(entry, ['auth'])).toBe('utils.diff');
    });

    it('should return feature-specific diff when feature is enabled', () => {
      const entry: FeatureMigrationEntry = {
        type: 'modify',
        path: 'src/routes.ts',
        features: {
          auth: 'routes-auth.diff',
          organizations: 'routes-orgs.diff',
          _base: 'routes-base.diff'
        }
      };

      expect(getFeatureSpecificDiff(entry, ['auth'])).toBe('routes-auth.diff');
      expect(getFeatureSpecificDiff(entry, ['organizations'])).toBe('routes-orgs.diff');
      expect(getFeatureSpecificDiff(entry, ['auth', 'organizations'])).toBe('routes-auth.diff');
    });

    it('should return base diff when no enabled features match', () => {
      const entry: FeatureMigrationEntry = {
        type: 'modify',
        path: 'src/routes.ts',
        features: {
          auth: 'routes-auth.diff',
          _base: 'routes-base.diff'
        }
      };

      expect(getFeatureSpecificDiff(entry, [])).toBe('routes-base.diff');
      expect(getFeatureSpecificDiff(entry, ['other'])).toBe('routes-base.diff');
    });

    it('should return null when no matching diff is found', () => {
      const entry: FeatureMigrationEntry = {
        type: 'modify',
        path: 'src/routes.ts',
        features: {
          auth: 'routes-auth.diff'
        }
      };

      expect(getFeatureSpecificDiff(entry, [])).toBeNull();
      expect(getFeatureSpecificDiff(entry, ['other'])).toBeNull();
    });
  });

  describe('readFeatureMigrationFromPath', () => {
    it('should read migration file and detect feature support', async () => {
      const migrationContent = `// Migration generated automatically
export const migration = {
  "src/auth/login.ts": {
    "type": "new",
    "path": "src/auth/login.ts",
    "featureExclusive": "auth"
  },
  "src/utils/helper.ts": {
    "type": "new",
    "path": "src/utils/helper.ts"
  }
} as const;
`;

      const migrationDir = join(tempDir, 'migration');
      await fs.mkdir(migrationDir, { recursive: true });
      await fs.writeFile(join(migrationDir, 'migrate.ts'), migrationContent);

      const { migration, hasFeatureSupport } = await readFeatureMigrationFromPath(migrationDir);

      expect(hasFeatureSupport).toBe(true);
      expect(migration['src/auth/login.ts'].featureExclusive).toBe('auth');
      expect(migration['src/utils/helper.ts'].featureExclusive).toBeUndefined();
    });

    it('should detect no feature support in legacy migrations', async () => {
      const migrationContent = `// Migration generated automatically
export const migration = {
  "src/utils/helper.ts": {
    "type": "new",
    "path": "src/utils/helper.ts"
  }
} as const;
`;

      const migrationDir = join(tempDir, 'migration');
      await fs.mkdir(migrationDir, { recursive: true });
      await fs.writeFile(join(migrationDir, 'migrate.ts'), migrationContent);

      const { migration, hasFeatureSupport } = await readFeatureMigrationFromPath(migrationDir);

      expect(hasFeatureSupport).toBe(false);
      expect(Object.keys(migration)).toEqual(['src/utils/helper.ts']);
    });
  });

  describe('writeFeatureMigrationFile', () => {
    it('should write migration file with feature properties', async () => {
      const migration: FeatureMigration = {
        'src/auth/login.ts': {
          type: 'new',
          path: 'src/auth/login.ts',
          featureExclusive: 'auth'
        },
        'src/routes.ts': {
          type: 'modify',
          path: 'src/routes.ts',
          features: {
            auth: 'routes-auth.diff',
            _base: 'routes-base.diff'
          }
        }
      };

      const filePath = join(tempDir, 'migrate.ts');
      await writeFeatureMigrationFile(filePath, migration);

      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toContain('featureExclusive');
      expect(content).toContain('features');
      expect(content).toContain('export const migration = {');
    });
  });

  describe('getMigrationFeatureRequirements', () => {
    it('should extract required features from migration', () => {
      const migration: FeatureMigration = {
        'src/auth/login.ts': {
          type: 'new',
          path: 'src/auth/login.ts',
          featureExclusive: 'auth'
        },
        'src/orgs/create.ts': {
          type: 'new',
          path: 'src/orgs/create.ts',
          featureExclusive: 'organizations'
        },
        'src/routes.ts': {
          type: 'modify',
          path: 'src/routes.ts',
          features: {
            billing: 'routes-billing.diff',
            _base: 'routes-base.diff'
          }
        }
      };

      const requirements = getMigrationFeatureRequirements(migration);
      expect(requirements.sort()).toEqual(['auth', 'billing', 'organizations']);
    });

    it('should return empty array for migration with no feature requirements', () => {
      const migration: FeatureMigration = {
        'src/utils/helper.ts': {
          type: 'new',
          path: 'src/utils/helper.ts'
        }
      };

      const requirements = getMigrationFeatureRequirements(migration);
      expect(requirements).toEqual([]);
    });
  });

  describe('canApplyMigration', () => {
    const migration: FeatureMigration = {
      'src/auth/login.ts': {
        type: 'new',
        path: 'src/auth/login.ts',
        featureExclusive: 'auth'
      },
      'src/orgs/create.ts': {
        type: 'new',
        path: 'src/orgs/create.ts',
        featureExclusive: 'organizations'
      }
    };

    it('should return true when all required features are enabled', () => {
      const { canApply, missingFeatures } = canApplyMigration(migration, ['auth', 'organizations']);

      expect(canApply).toBe(true);
      expect(missingFeatures).toEqual([]);
    });

    it('should return false when some features are missing', () => {
      const { canApply, missingFeatures } = canApplyMigration(migration, ['auth']);

      expect(canApply).toBe(false);
      expect(missingFeatures).toEqual(['organizations']);
    });
  });

  describe('extractFeatureFilesFromMigration', () => {
    it('should extract feature files from applicable entries', () => {
      const migration: FeatureMigration = {
        'src/auth/login.ts': {
          type: 'new',
          path: 'src/auth/login.ts',
          featureExclusive: 'auth'
        },
        'src/auth/register.ts': {
          type: 'new',
          path: 'src/auth/register.ts',
          featureExclusive: 'auth'
        },
        'src/orgs/create.ts': {
          type: 'new',
          path: 'src/orgs/create.ts',
          featureExclusive: 'organizations'
        }
      };

      const featureFiles = extractFeatureFilesFromMigration(migration, ['auth']);

      expect(featureFiles).toEqual({
        auth: ['src/auth/login.ts', 'src/auth/register.ts']
      });
    });

    it('should only include new files', () => {
      const migration: FeatureMigration = {
        'src/auth/login.ts': {
          type: 'new',
          path: 'src/auth/login.ts',
          featureExclusive: 'auth'
        },
        'src/auth/existing.ts': {
          type: 'modify',
          path: 'src/auth/existing.ts',
          featureExclusive: 'auth'
        }
      };

      const featureFiles = extractFeatureFilesFromMigration(migration, ['auth']);

      expect(featureFiles).toEqual({
        auth: ['src/auth/login.ts']
      });
    });
  });

  describe('isFeatureContentBlock', () => {
    it('should detect feature start blocks', () => {
      const result = isFeatureContentBlock('// @feature:auth:start');
      expect(result.isBlock).toBe(true);
      expect(result.feature).toBe('auth');
      expect(result.isStart).toBe(true);
    });

    it('should detect feature end blocks', () => {
      const result = isFeatureContentBlock('// @feature:organizations:end');
      expect(result.isBlock).toBe(true);
      expect(result.feature).toBe('organizations');
      expect(result.isEnd).toBe(true);
    });

    it('should handle whitespace variations', () => {
      const result = isFeatureContentBlock('  //   @feature:auth:start  ');
      expect(result.isBlock).toBe(true);
      expect(result.feature).toBe('auth');
    });

    it('should return false for non-feature lines', () => {
      const result = isFeatureContentBlock('const user = getUser();');
      expect(result.isBlock).toBe(false);
    });
  });

  describe('isInjectionPoint', () => {
    it('should detect injection points', () => {
      const result = isInjectionPoint('// @inject-point:onboarding-steps');
      expect(result.isInjectionPoint).toBe(true);
      expect(result.pointName).toBe('onboarding-steps');
    });

    it('should handle whitespace variations', () => {
      const result = isInjectionPoint('  //   @inject-point:auth-routes  ');
      expect(result.isInjectionPoint).toBe(true);
      expect(result.pointName).toBe('auth-routes');
    });

    it('should return false for non-injection lines', () => {
      const result = isInjectionPoint('const routes = [];');
      expect(result.isInjectionPoint).toBe(false);
    });
  });

  describe('processFeatureConditionalContent', () => {
    it('should include content when feature is enabled', () => {
      const content = `const base = true;
// @feature:auth:start
const authEnabled = true;
// @feature:auth:end
const end = true;`;

      const result = processFeatureConditionalContent(content, ['auth']);
      
      expect(result).toBe(`const base = true;
const authEnabled = true;
const end = true;`);
    });

    it('should exclude content when feature is disabled', () => {
      const content = `const base = true;
// @feature:auth:start
const authEnabled = true;
// @feature:auth:end
const end = true;`;

      const result = processFeatureConditionalContent(content, []);
      
      expect(result).toBe(`const base = true;
const end = true;`);
    });

    it('should handle nested feature blocks', () => {
      const content = `const base = true;
// @feature:auth:start
const auth = true;
// @feature:organizations:start
const orgs = true;
// @feature:organizations:end
const authEnd = true;
// @feature:auth:end
const end = true;`;

      const result = processFeatureConditionalContent(content, ['auth']);
      
      expect(result).toBe(`const base = true;
const auth = true;
const authEnd = true;
const end = true;`);
    });

    it('should include content when all nested features are enabled', () => {
      const content = `const base = true;
// @feature:auth:start
const auth = true;
// @feature:organizations:start
const orgs = true;
// @feature:organizations:end
const authEnd = true;
// @feature:auth:end
const end = true;`;

      const result = processFeatureConditionalContent(content, ['auth', 'organizations']);
      
      expect(result).toBe(`const base = true;
const auth = true;
const orgs = true;
const authEnd = true;
const end = true;`);
    });
  });
});