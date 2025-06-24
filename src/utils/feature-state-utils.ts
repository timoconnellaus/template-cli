import { promises as fs } from 'fs';
import { join } from 'path';
import { 
  type FeatureManifest, 
  type ProjectConfig, 
  readProjectConfig, 
  writeProjectConfig,
  validateFeatureDependenciesForEnabledSet,
  resolveDependenciesForFeatures,
  canDisableFeature
} from './feature-utils.js';

export interface FeatureStateChange {
  feature: string;
  action: 'enable' | 'disable';
  appliedMigrations?: string[];
  removedFiles?: string[];
}

export interface FeatureState {
  enabledFeatures: string[];
  availableFeatures: string[];
  featureFiles: Record<string, string[]>;
}

export async function getCurrentFeatureState(
  projectPath: string, 
  manifest: FeatureManifest | null
): Promise<FeatureState> {
  const config = await readProjectConfig(projectPath);
  const enabledFeatures = config?.enabledFeatures || [];
  const availableFeatures = manifest ? Object.keys(manifest.features) : [];
  
  const appliedMigrationsPath = join(projectPath, 'applied-migrations.json');
  let featureFiles: Record<string, string[]> = {};
  
  try {
    const appliedMigrationsContent = await fs.readFile(appliedMigrationsPath, 'utf8');
    const appliedMigrations = JSON.parse(appliedMigrationsContent);
    featureFiles = appliedMigrations.featureFiles || {};
  } catch (error) {
    // File doesn't exist or is invalid, start with empty tracking
  }
  
  return {
    enabledFeatures,
    availableFeatures,
    featureFiles
  };
}

export async function enableFeature(
  projectPath: string,
  featureName: string,
  manifest: FeatureManifest
): Promise<FeatureStateChange> {
  const config = await readProjectConfig(projectPath) || {
    version: '1.0.0',
    enabledFeatures: []
  };
  
  if (config.enabledFeatures.includes(featureName)) {
    throw new Error(`Feature "${featureName}" is already enabled`);
  }
  
  if (!manifest.features[featureName]) {
    throw new Error(`Unknown feature: ${featureName}`);
  }
  
  const resolvedFeatures = resolveDependenciesForFeatures([featureName], manifest);
  const newFeatures = resolvedFeatures.filter(f => !config.enabledFeatures.includes(f));
  
  if (newFeatures.length === 0) {
    throw new Error(`Feature "${featureName}" is already enabled (including dependencies)`);
  }
  
  const updatedFeatures = [...config.enabledFeatures, ...newFeatures].sort();
  
  validateFeatureDependenciesForEnabledSet(updatedFeatures, manifest);
  
  const updatedConfig = {
    ...config,
    enabledFeatures: updatedFeatures
  };
  
  await writeProjectConfig(projectPath, updatedConfig);
  
  return {
    feature: featureName,
    action: 'enable',
    appliedMigrations: []
  };
}

export async function disableFeature(
  projectPath: string,
  featureName: string,
  manifest: FeatureManifest
): Promise<FeatureStateChange> {
  const config = await readProjectConfig(projectPath);
  
  if (!config) {
    throw new Error('No project configuration found. Run init first.');
  }
  
  if (!config.enabledFeatures.includes(featureName)) {
    throw new Error(`Feature "${featureName}" is not enabled`);
  }
  
  const { canDisable, dependentFeatures } = canDisableFeature(
    featureName, 
    config.enabledFeatures, 
    manifest
  );
  
  if (!canDisable) {
    throw new Error(
      `Cannot disable feature "${featureName}" because it is required by: ${dependentFeatures.join(', ')}`
    );
  }
  
  const updatedFeatures = config.enabledFeatures.filter(f => f !== featureName);
  
  const updatedConfig = {
    ...config,
    enabledFeatures: updatedFeatures
  };
  
  await writeProjectConfig(projectPath, updatedConfig);
  
  const featureState = await getCurrentFeatureState(projectPath, manifest);
  const removedFiles = featureState.featureFiles[featureName] || [];
  
  return {
    feature: featureName,
    action: 'disable',
    removedFiles
  };
}

export async function setEnabledFeatures(
  projectPath: string,
  features: string[],
  manifest: FeatureManifest
): Promise<void> {
  const resolvedFeatures = resolveDependenciesForFeatures(features, manifest);
  validateFeatureDependenciesForEnabledSet(resolvedFeatures, manifest);
  
  const config = await readProjectConfig(projectPath) || {
    version: '1.0.0',
    enabledFeatures: []
  };
  
  const updatedConfig = {
    ...config,
    enabledFeatures: resolvedFeatures.sort()
  };
  
  await writeProjectConfig(projectPath, updatedConfig);
}

export function getFeatureDifference(
  currentFeatures: string[],
  targetFeatures: string[]
): { toEnable: string[]; toDisable: string[] } {
  const currentSet = new Set(currentFeatures);
  const targetSet = new Set(targetFeatures);
  
  const toEnable = targetFeatures.filter(f => !currentSet.has(f));
  const toDisable = currentFeatures.filter((f: string) => !targetSet.has(f));
  
  return { toEnable, toDisable };
}

export async function updateFeatureFileTracking(
  projectPath: string,
  feature: string,
  files: string[],
  action: 'add' | 'remove'
): Promise<void> {
  const appliedMigrationsPath = join(projectPath, 'applied-migrations.json');
  
  let appliedMigrations: any = {
    version: '1.0.0',
    template: '',
    appliedMigrations: [],
    enabledFeatures: [],
    skippedMigrations: [],
    featureFiles: {}
  };
  
  try {
    const content = await fs.readFile(appliedMigrationsPath, 'utf8');
    appliedMigrations = JSON.parse(content);
    
    if (!appliedMigrations.featureFiles) {
      appliedMigrations.featureFiles = {};
    }
  } catch (error) {
    // File doesn't exist, use defaults
  }
  
  if (action === 'add') {
    const existingFiles = appliedMigrations.featureFiles[feature] || [];
    const newFiles = files.filter(f => !existingFiles.includes(f));
    appliedMigrations.featureFiles[feature] = [...existingFiles, ...newFiles];
  } else {
    const existingFiles = appliedMigrations.featureFiles[feature] || [];
    appliedMigrations.featureFiles[feature] = existingFiles.filter(f => !files.includes(f));
    
    if (appliedMigrations.featureFiles[feature].length === 0) {
      delete appliedMigrations.featureFiles[feature];
    }
  }
  
  await fs.writeFile(appliedMigrationsPath, JSON.stringify(appliedMigrations, null, 2), 'utf8');
}

export function isFeatureEnabled(featureName: string, enabledFeatures: string[]): boolean {
  return enabledFeatures.includes(featureName);
}

export function areFeatureDependenciesSatisfied(
  feature: string,
  enabledFeatures: string[],
  manifest: FeatureManifest
): boolean {
  const featureEntry = manifest.features[feature];
  if (!featureEntry || !featureEntry.dependencies) {
    return true;
  }
  
  const enabledSet = new Set(enabledFeatures);
  return featureEntry.dependencies.every(dep => enabledSet.has(dep));
}

export async function syncFeatureStateWithConfig(
  projectPath: string,
  manifest: FeatureManifest
): Promise<void> {
  const config = await readProjectConfig(projectPath);
  if (!config) {
    return;
  }
  
  const appliedMigrationsPath = join(projectPath, 'applied-migrations.json');
  
  try {
    const content = await fs.readFile(appliedMigrationsPath, 'utf8');
    const appliedMigrations = JSON.parse(content);
    
    appliedMigrations.enabledFeatures = config.enabledFeatures;
    
    await fs.writeFile(appliedMigrationsPath, JSON.stringify(appliedMigrations, null, 2), 'utf8');
  } catch (error) {
    // File doesn't exist, ignore
  }
}