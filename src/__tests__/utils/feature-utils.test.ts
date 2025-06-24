import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp } from 'fs/promises';
import {
  parseFeatureManifest,
  validateFeatureManifest,
  readProjectConfig,
  writeProjectConfig,
  isFileFeatureExclusive,
  getFileFeatures,
  validateFeatureDependenciesForEnabledSet,
  resolveDependenciesForFeatures,
  canDisableFeature,
  type FeatureManifest,
  type ProjectConfig,
  type FeatureEntry,
} from '../../utils/feature-utils.js';

describe('feature-utils', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'feature-utils-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('parseFeatureManifest', () => {
    it('should parse valid feature manifest', async () => {
      const manifest: FeatureManifest = {
        version: '1.0.0',
        features: {
          auth: {
            description: 'Authentication system',
            dependencies: [],
            exclusivePatterns: ['src/auth/**']
          }
        }
      };

      await fs.writeFile(
        join(tempDir, 'template-features.json'),
        JSON.stringify(manifest, null, 2)
      );

      const result = await parseFeatureManifest(tempDir);
      expect(result).toEqual(manifest);
    });

    it('should return null when manifest does not exist', async () => {
      const result = await parseFeatureManifest(tempDir);
      expect(result).toBeNull();
    });

    it('should throw error for invalid JSON', async () => {
      await fs.writeFile(
        join(tempDir, 'template-features.json'),
        'invalid json'
      );

      await expect(parseFeatureManifest(tempDir)).rejects.toThrow('Failed to parse feature manifest');
    });
  });

  describe('validateFeatureManifest', () => {
    it('should validate manifest with no dependencies', () => {
      const manifest: FeatureManifest = {
        version: '1.0.0',
        features: {
          auth: {
            description: 'Authentication',
            exclusivePatterns: ['src/auth/**']
          }
        }
      };

      expect(() => validateFeatureManifest(manifest)).not.toThrow();
    });

    it('should validate manifest with valid dependencies', () => {
      const manifest: FeatureManifest = {
        version: '1.0.0',
        features: {
          auth: {
            description: 'Authentication'
          },
          billing: {
            description: 'Billing',
            dependencies: ['auth']
          }
        }
      };

      expect(() => validateFeatureManifest(manifest)).not.toThrow();
    });

    it('should throw error when version is missing', () => {
      const manifest = {
        features: {
          auth: { description: 'Auth' }
        }
      } as any;

      expect(() => validateFeatureManifest(manifest)).toThrow('Feature manifest must have a version');
    });

    it('should throw error when features object is missing', () => {
      const manifest = {
        version: '1.0.0'
      } as any;

      expect(() => validateFeatureManifest(manifest)).toThrow('Feature manifest must have a features object');
    });

    it('should throw error when feature has no description', () => {
      const manifest: FeatureManifest = {
        version: '1.0.0',
        features: {
          auth: {} as any
        }
      };

      expect(() => validateFeatureManifest(manifest)).toThrow('Feature "auth" must have a description');
    });

    it('should throw error for unknown dependency', () => {
      const manifest: FeatureManifest = {
        version: '1.0.0',
        features: {
          billing: {
            description: 'Billing',
            dependencies: ['unknown']
          }
        }
      };

      expect(() => validateFeatureManifest(manifest)).toThrow('Feature "billing" depends on unknown feature "unknown"');
    });

    it('should throw error for circular dependency', () => {
      const manifest: FeatureManifest = {
        version: '1.0.0',
        features: {
          auth: {
            description: 'Auth',
            dependencies: ['billing']
          },
          billing: {
            description: 'Billing',
            dependencies: ['auth']
          }
        }
      };

      expect(() => validateFeatureManifest(manifest)).toThrow('Circular dependency detected');
    });

    it('should throw error for invalid dependencies array', () => {
      const manifest = {
        version: '1.0.0',
        features: {
          auth: {
            description: 'Auth',
            dependencies: 'not-an-array'
          }
        }
      } as any;

      expect(() => validateFeatureManifest(manifest)).toThrow('Feature "auth" dependencies must be an array');
    });

    it('should throw error for invalid exclusivePatterns', () => {
      const manifest = {
        version: '1.0.0',
        features: {
          auth: {
            description: 'Auth',
            exclusivePatterns: 'not-an-array'
          }
        }
      } as any;

      expect(() => validateFeatureManifest(manifest)).toThrow('Feature "auth" exclusivePatterns must be an array');
    });
  });

  describe('readProjectConfig', () => {
    it('should read valid project config', async () => {
      const config: ProjectConfig = {
        version: '1.0.0',
        enabledFeatures: ['auth', 'billing']
      };

      await fs.writeFile(
        join(tempDir, 'project-config.json'),
        JSON.stringify(config, null, 2)
      );

      const result = await readProjectConfig(tempDir);
      expect(result).toEqual(config);
    });

    it('should return null when config does not exist', async () => {
      const result = await readProjectConfig(tempDir);
      expect(result).toBeNull();
    });

    it('should throw error for invalid config', async () => {
      const config = {
        version: '1.0.0'
        // missing enabledFeatures
      };

      await fs.writeFile(
        join(tempDir, 'project-config.json'),
        JSON.stringify(config, null, 2)
      );

      await expect(readProjectConfig(tempDir)).rejects.toThrow('Project config must have enabledFeatures array');
    });
  });

  describe('writeProjectConfig', () => {
    it('should write project config', async () => {
      const config: ProjectConfig = {
        version: '1.0.0',
        enabledFeatures: ['auth']
      };

      await writeProjectConfig(tempDir, config);

      const content = await fs.readFile(join(tempDir, 'project-config.json'), 'utf8');
      expect(JSON.parse(content)).toEqual(config);
    });
  });

  describe('isFileFeatureExclusive', () => {
    const feature: FeatureEntry = {
      description: 'Test feature',
      exclusivePatterns: [
        'src/auth/**',
        'src/pages/auth-*',
        '**/*.auth.{ts,tsx}'
      ]
    };

    it('should return true for matching patterns', () => {
      expect(isFileFeatureExclusive('src/auth/login.ts', feature)).toBe(true);
      expect(isFileFeatureExclusive('src/auth/components/LoginForm.tsx', feature)).toBe(true);
      expect(isFileFeatureExclusive('src/pages/auth-login.tsx', feature)).toBe(true);
      expect(isFileFeatureExclusive('src/components/LoginButton.auth.ts', feature)).toBe(true);
    });

    it('should return false for non-matching patterns', () => {
      expect(isFileFeatureExclusive('src/components/Header.tsx', feature)).toBe(false);
      expect(isFileFeatureExclusive('src/pages/dashboard.tsx', feature)).toBe(false);
    });

    it('should return false when no patterns defined', () => {
      const featureWithoutPatterns: FeatureEntry = {
        description: 'Test feature'
      };

      expect(isFileFeatureExclusive('src/auth/login.ts', featureWithoutPatterns)).toBe(false);
    });
  });

  describe('getFileFeatures', () => {
    const manifest: FeatureManifest = {
      version: '1.0.0',
      features: {
        auth: {
          description: 'Authentication',
          exclusivePatterns: ['src/auth/**']
        },
        billing: {
          description: 'Billing',
          exclusivePatterns: ['src/billing/**']
        },
        analytics: {
          description: 'Analytics',
          exclusivePatterns: ['**/*.analytics.ts']
        }
      }
    };

    it('should return features for matching files', () => {
      expect(getFileFeatures('src/auth/login.ts', manifest)).toEqual(['auth']);
      expect(getFileFeatures('src/billing/plans.tsx', manifest)).toEqual(['billing']);
      expect(getFileFeatures('src/utils/track.analytics.ts', manifest)).toEqual(['analytics']);
    });

    it('should return empty array for non-matching files', () => {
      expect(getFileFeatures('src/components/Header.tsx', manifest)).toEqual([]);
    });

    it('should return multiple features if file matches multiple patterns', () => {
      const multiFeatureManifest: FeatureManifest = {
        version: '1.0.0',
        features: {
          auth: {
            description: 'Auth',
            exclusivePatterns: ['src/shared/**']
          },
          billing: {
            description: 'Billing',
            exclusivePatterns: ['src/shared/**']
          }
        }
      };

      expect(getFileFeatures('src/shared/utils.ts', multiFeatureManifest)).toEqual(['auth', 'billing']);
    });
  });

  describe('validateFeatureDependenciesForEnabledSet', () => {
    const manifest: FeatureManifest = {
      version: '1.0.0',
      features: {
        auth: {
          description: 'Authentication'
        },
        organizations: {
          description: 'Organizations',
          dependencies: ['auth']
        },
        billing: {
          description: 'Billing',
          dependencies: ['organizations']
        }
      }
    };

    it('should validate when all dependencies are satisfied', () => {
      expect(() => 
        validateFeatureDependenciesForEnabledSet(['auth', 'organizations', 'billing'], manifest)
      ).not.toThrow();
    });

    it('should throw error when dependency is missing', () => {
      expect(() => 
        validateFeatureDependenciesForEnabledSet(['organizations'], manifest)
      ).toThrow('Feature "organizations" requires feature "auth" to be enabled');
    });

    it('should throw error for unknown feature', () => {
      expect(() => 
        validateFeatureDependenciesForEnabledSet(['unknown'], manifest)
      ).toThrow('Unknown feature: unknown');
    });
  });

  describe('resolveDependenciesForFeatures', () => {
    const manifest: FeatureManifest = {
      version: '1.0.0',
      features: {
        auth: {
          description: 'Authentication'
        },
        organizations: {
          description: 'Organizations',
          dependencies: ['auth']
        },
        billing: {
          description: 'Billing',
          dependencies: ['organizations']
        }
      }
    };

    it('should resolve dependencies for single feature', () => {
      const result = resolveDependenciesForFeatures(['billing'], manifest);
      expect(result.sort()).toEqual(['auth', 'billing', 'organizations']);
    });

    it('should resolve dependencies for multiple features', () => {
      const result = resolveDependenciesForFeatures(['billing', 'organizations'], manifest);
      expect(result.sort()).toEqual(['auth', 'billing', 'organizations']);
    });

    it('should handle features with no dependencies', () => {
      const result = resolveDependenciesForFeatures(['auth'], manifest);
      expect(result).toEqual(['auth']);
    });

    it('should throw error for unknown feature', () => {
      expect(() => 
        resolveDependenciesForFeatures(['unknown'], manifest)
      ).toThrow('Unknown feature: unknown');
    });
  });

  describe('canDisableFeature', () => {
    const manifest: FeatureManifest = {
      version: '1.0.0',
      features: {
        auth: {
          description: 'Authentication'
        },
        organizations: {
          description: 'Organizations',
          dependencies: ['auth']
        },
        billing: {
          description: 'Billing',
          dependencies: ['organizations']
        }
      }
    };

    it('should allow disabling feature with no dependents', () => {
      const result = canDisableFeature('billing', ['auth', 'organizations', 'billing'], manifest);
      expect(result.canDisable).toBe(true);
      expect(result.dependentFeatures).toEqual([]);
    });

    it('should prevent disabling feature with dependents', () => {
      const result = canDisableFeature('auth', ['auth', 'organizations', 'billing'], manifest);
      expect(result.canDisable).toBe(false);
      expect(result.dependentFeatures).toEqual(['organizations']);
    });

    it('should prevent disabling feature with multiple dependents', () => {
      const extendedManifest: FeatureManifest = {
        ...manifest,
        features: {
          ...manifest.features,
          analytics: {
            description: 'Analytics',
            dependencies: ['auth']
          }
        }
      };

      const result = canDisableFeature('auth', ['auth', 'organizations', 'analytics'], extendedManifest);
      expect(result.canDisable).toBe(false);
      expect(result.dependentFeatures.sort()).toEqual(['analytics', 'organizations']);
    });
  });
});