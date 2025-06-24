import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp } from 'fs/promises';
import {
  getCurrentFeatureState,
  enableFeature,
  disableFeature,
  setEnabledFeatures,
  getFeatureDifference,
  updateFeatureFileTracking,
  isFeatureEnabled,
  areFeatureDependenciesSatisfied,
  syncFeatureStateWithConfig,
  type FeatureStateChange,
  type FeatureState,
} from '../../utils/feature-state-utils.js';
import { type FeatureManifest, type ProjectConfig } from '../../utils/feature-utils.js';

describe('feature-state-utils', () => {
  let tempDir: string;
  let manifest: FeatureManifest;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'feature-state-test-'));
    
    manifest = {
      version: '1.0.0',
      features: {
        auth: {
          description: 'Authentication system',
          exclusivePatterns: ['src/auth/**']
        },
        organizations: {
          description: 'Organizations',
          dependencies: ['auth'],
          exclusivePatterns: ['src/orgs/**']
        },
        billing: {
          description: 'Billing',
          dependencies: ['organizations'],
          exclusivePatterns: ['src/billing/**']
        }
      }
    };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('getCurrentFeatureState', () => {
    it('should return empty state when no config exists', async () => {
      const state = await getCurrentFeatureState(tempDir, manifest);
      
      expect(state.enabledFeatures).toEqual([]);
      expect(state.availableFeatures.sort()).toEqual(['auth', 'billing', 'organizations']);
      expect(state.featureFiles).toEqual({});
    });

    it('should return state from project config', async () => {
      const config: ProjectConfig = {
        version: '1.0.0',
        enabledFeatures: ['auth', 'organizations']
      };

      await fs.writeFile(
        join(tempDir, 'project-config.json'),
        JSON.stringify(config, null, 2)
      );

      const state = await getCurrentFeatureState(tempDir, manifest);
      
      expect(state.enabledFeatures).toEqual(['auth', 'organizations']);
      expect(state.availableFeatures.sort()).toEqual(['auth', 'billing', 'organizations']);
    });

    it('should include feature files from applied-migrations.json', async () => {
      const config: ProjectConfig = {
        version: '1.0.0',
        enabledFeatures: ['auth']
      };

      const appliedMigrations = {
        version: '1.0.0',
        template: '/template',
        appliedMigrations: [],
        featureFiles: {
          auth: ['src/auth/login.ts', 'src/auth/register.ts']
        }
      };

      await fs.writeFile(
        join(tempDir, 'project-config.json'),
        JSON.stringify(config, null, 2)
      );

      await fs.writeFile(
        join(tempDir, 'applied-migrations.json'),
        JSON.stringify(appliedMigrations, null, 2)
      );

      const state = await getCurrentFeatureState(tempDir, manifest);
      
      expect(state.featureFiles).toEqual({
        auth: ['src/auth/login.ts', 'src/auth/register.ts']
      });
    });

    it('should handle null manifest', async () => {
      const state = await getCurrentFeatureState(tempDir, null);
      
      expect(state.availableFeatures).toEqual([]);
    });
  });

  describe('enableFeature', () => {
    it('should enable feature with no dependencies', async () => {
      const result = await enableFeature(tempDir, 'auth', manifest);
      
      expect(result.feature).toBe('auth');
      expect(result.action).toBe('enable');
      
      const config = JSON.parse(await fs.readFile(join(tempDir, 'project-config.json'), 'utf8'));
      expect(config.enabledFeatures).toEqual(['auth']);
    });

    it('should enable feature with dependencies', async () => {
      const result = await enableFeature(tempDir, 'billing', manifest);
      
      expect(result.feature).toBe('billing');
      expect(result.action).toBe('enable');
      
      const config = JSON.parse(await fs.readFile(join(tempDir, 'project-config.json'), 'utf8'));
      expect(config.enabledFeatures.sort()).toEqual(['auth', 'billing', 'organizations']);
    });

    it('should not duplicate already enabled features', async () => {
      const initialConfig: ProjectConfig = {
        version: '1.0.0',
        enabledFeatures: ['auth']
      };

      await fs.writeFile(
        join(tempDir, 'project-config.json'),
        JSON.stringify(initialConfig, null, 2)
      );

      const result = await enableFeature(tempDir, 'organizations', manifest);
      
      const config = JSON.parse(await fs.readFile(join(tempDir, 'project-config.json'), 'utf8'));
      expect(config.enabledFeatures.sort()).toEqual(['auth', 'organizations']);
    });

    it('should throw error for already enabled feature', async () => {
      const initialConfig: ProjectConfig = {
        version: '1.0.0',
        enabledFeatures: ['auth']
      };

      await fs.writeFile(
        join(tempDir, 'project-config.json'),
        JSON.stringify(initialConfig, null, 2)
      );

      await expect(enableFeature(tempDir, 'auth', manifest)).rejects.toThrow(
        'Feature "auth" is already enabled'
      );
    });

    it('should throw error for unknown feature', async () => {
      await expect(enableFeature(tempDir, 'unknown', manifest)).rejects.toThrow(
        'Unknown feature: unknown'
      );
    });
  });

  describe('disableFeature', () => {
    beforeEach(async () => {
      const config: ProjectConfig = {
        version: '1.0.0',
        enabledFeatures: ['auth', 'organizations', 'billing']
      };

      await fs.writeFile(
        join(tempDir, 'project-config.json'),
        JSON.stringify(config, null, 2)
      );
    });

    it('should disable feature with no dependents', async () => {
      const result = await disableFeature(tempDir, 'billing', manifest);
      
      expect(result.feature).toBe('billing');
      expect(result.action).toBe('disable');
      
      const config = JSON.parse(await fs.readFile(join(tempDir, 'project-config.json'), 'utf8'));
      expect(config.enabledFeatures).toEqual(['auth', 'organizations']);
    });

    it('should include removed files in result', async () => {
      const appliedMigrations = {
        version: '1.0.0',
        template: '/template',
        appliedMigrations: [],
        featureFiles: {
          billing: ['src/billing/plans.ts', 'src/billing/checkout.ts']
        }
      };

      await fs.writeFile(
        join(tempDir, 'applied-migrations.json'),
        JSON.stringify(appliedMigrations, null, 2)
      );

      const result = await disableFeature(tempDir, 'billing', manifest);
      
      expect(result.removedFiles).toEqual(['src/billing/plans.ts', 'src/billing/checkout.ts']);
    });

    it('should throw error when feature has dependents', async () => {
      await expect(disableFeature(tempDir, 'auth', manifest)).rejects.toThrow(
        'Cannot disable feature "auth" because it is required by: organizations'
      );
    });

    it('should throw error when feature is not enabled', async () => {
      const config: ProjectConfig = {
        version: '1.0.0',
        enabledFeatures: ['auth']
      };

      await fs.writeFile(
        join(tempDir, 'project-config.json'),
        JSON.stringify(config, null, 2)
      );

      await expect(disableFeature(tempDir, 'billing', manifest)).rejects.toThrow(
        'Feature "billing" is not enabled'
      );
    });

    it('should throw error when no project config exists', async () => {
      await fs.rm(join(tempDir, 'project-config.json'), { force: true });

      await expect(disableFeature(tempDir, 'billing', manifest)).rejects.toThrow(
        'No project configuration found. Run init first.'
      );
    });
  });

  describe('setEnabledFeatures', () => {
    it('should set features with dependencies resolved', async () => {
      await setEnabledFeatures(tempDir, ['billing'], manifest);
      
      const config = JSON.parse(await fs.readFile(join(tempDir, 'project-config.json'), 'utf8'));
      expect(config.enabledFeatures.sort()).toEqual(['auth', 'billing', 'organizations']);
    });

    it('should update existing config', async () => {
      const initialConfig: ProjectConfig = {
        version: '1.0.0',
        enabledFeatures: ['auth'],
        templateVersion: '1.0.0'
      };

      await fs.writeFile(
        join(tempDir, 'project-config.json'),
        JSON.stringify(initialConfig, null, 2)
      );

      await setEnabledFeatures(tempDir, ['organizations'], manifest);
      
      const config = JSON.parse(await fs.readFile(join(tempDir, 'project-config.json'), 'utf8'));
      expect(config.enabledFeatures.sort()).toEqual(['auth', 'organizations']);
      expect(config.templateVersion).toBe('1.0.0'); // Should preserve existing properties
    });
  });

  describe('getFeatureDifference', () => {
    it('should identify features to enable and disable', () => {
      const current = ['auth', 'billing'];
      const target = ['auth', 'organizations'];
      
      const diff = getFeatureDifference(current, target);
      
      expect(diff.toEnable).toEqual(['organizations']);
      expect(diff.toDisable).toEqual(['billing']);
    });

    it('should handle no changes', () => {
      const current = ['auth', 'organizations'];
      const target = ['auth', 'organizations'];
      
      const diff = getFeatureDifference(current, target);
      
      expect(diff.toEnable).toEqual([]);
      expect(diff.toDisable).toEqual([]);
    });
  });

  describe('updateFeatureFileTracking', () => {
    it('should add files to feature tracking', async () => {
      const appliedMigrations = {
        version: '1.0.0',
        template: '/template',
        appliedMigrations: [],
        featureFiles: {}
      };

      await fs.writeFile(
        join(tempDir, 'applied-migrations.json'),
        JSON.stringify(appliedMigrations, null, 2)
      );

      await updateFeatureFileTracking(tempDir, 'auth', ['src/auth/login.ts'], 'add');
      
      const updated = JSON.parse(await fs.readFile(join(tempDir, 'applied-migrations.json'), 'utf8'));
      expect(updated.featureFiles.auth).toEqual(['src/auth/login.ts']);
    });

    it('should remove files from feature tracking', async () => {
      const appliedMigrations = {
        version: '1.0.0',
        template: '/template',
        appliedMigrations: [],
        featureFiles: {
          auth: ['src/auth/login.ts', 'src/auth/register.ts']
        }
      };

      await fs.writeFile(
        join(tempDir, 'applied-migrations.json'),
        JSON.stringify(appliedMigrations, null, 2)
      );

      await updateFeatureFileTracking(tempDir, 'auth', ['src/auth/login.ts'], 'remove');
      
      const updated = JSON.parse(await fs.readFile(join(tempDir, 'applied-migrations.json'), 'utf8'));
      expect(updated.featureFiles.auth).toEqual(['src/auth/register.ts']);
    });

    it('should create applied-migrations.json if it does not exist', async () => {
      await updateFeatureFileTracking(tempDir, 'auth', ['src/auth/login.ts'], 'add');
      
      const content = await fs.readFile(join(tempDir, 'applied-migrations.json'), 'utf8');
      const data = JSON.parse(content);
      expect(data.featureFiles.auth).toEqual(['src/auth/login.ts']);
    });

    it('should remove feature key when no files remain', async () => {
      const appliedMigrations = {
        version: '1.0.0',
        template: '/template',
        appliedMigrations: [],
        featureFiles: {
          auth: ['src/auth/login.ts']
        }
      };

      await fs.writeFile(
        join(tempDir, 'applied-migrations.json'),
        JSON.stringify(appliedMigrations, null, 2)
      );

      await updateFeatureFileTracking(tempDir, 'auth', ['src/auth/login.ts'], 'remove');
      
      const updated = JSON.parse(await fs.readFile(join(tempDir, 'applied-migrations.json'), 'utf8'));
      expect(updated.featureFiles.auth).toBeUndefined();
    });
  });

  describe('isFeatureEnabled', () => {
    it('should return true for enabled feature', () => {
      expect(isFeatureEnabled('auth', ['auth', 'organizations'])).toBe(true);
    });

    it('should return false for disabled feature', () => {
      expect(isFeatureEnabled('billing', ['auth', 'organizations'])).toBe(false);
    });
  });

  describe('areFeatureDependenciesSatisfied', () => {
    it('should return true when dependencies are satisfied', () => {
      expect(areFeatureDependenciesSatisfied('organizations', ['auth', 'organizations'], manifest)).toBe(true);
    });

    it('should return false when dependencies are not satisfied', () => {
      expect(areFeatureDependenciesSatisfied('organizations', ['organizations'], manifest)).toBe(false);
    });

    it('should return true for features with no dependencies', () => {
      expect(areFeatureDependenciesSatisfied('auth', [], manifest)).toBe(true);
    });
  });

  describe('syncFeatureStateWithConfig', () => {
    it('should sync enabled features to applied-migrations.json', async () => {
      const config: ProjectConfig = {
        version: '1.0.0',
        enabledFeatures: ['auth', 'organizations']
      };

      const appliedMigrations = {
        version: '1.0.0',
        template: '/template',
        appliedMigrations: [],
        enabledFeatures: ['auth']
      };

      await fs.writeFile(
        join(tempDir, 'project-config.json'),
        JSON.stringify(config, null, 2)
      );

      await fs.writeFile(
        join(tempDir, 'applied-migrations.json'),
        JSON.stringify(appliedMigrations, null, 2)
      );

      await syncFeatureStateWithConfig(tempDir, manifest);
      
      const updated = JSON.parse(await fs.readFile(join(tempDir, 'applied-migrations.json'), 'utf8'));
      expect(updated.enabledFeatures).toEqual(['auth', 'organizations']);
    });

    it('should handle missing project config', async () => {
      await syncFeatureStateWithConfig(tempDir, manifest);
      // Should not throw error
    });

    it('should handle missing applied-migrations.json', async () => {
      const config: ProjectConfig = {
        version: '1.0.0',
        enabledFeatures: ['auth']
      };

      await fs.writeFile(
        join(tempDir, 'project-config.json'),
        JSON.stringify(config, null, 2)
      );

      await syncFeatureStateWithConfig(tempDir, manifest);
      // Should not throw error
    });
  });
});