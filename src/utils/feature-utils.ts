import { promises as fs } from 'fs';
import { join } from 'path';
import { minimatch } from 'minimatch';

export interface FeatureManifest {
  version: string;
  features: Record<string, FeatureEntry>;
}

export interface FeatureEntry {
  description: string;
  dependencies?: string[];
  exclusivePatterns?: string[];
  sharedFiles?: Record<string, string[]>;
  injectionPoints?: Record<string, InjectionPoint>;
}

export interface InjectionPoint {
  file: string;
  content: string;
  position: string;
}

export interface ProjectConfig {
  version: string;
  enabledFeatures: string[];
  templateVersion?: string;
}

export async function parseFeatureManifest(templatePath: string): Promise<FeatureManifest | null> {
  const manifestPath = join(templatePath, 'template-features.json');
  
  try {
    const content = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(content) as FeatureManifest;
    
    validateFeatureManifest(manifest);
    return manifest;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw new Error(`Failed to parse feature manifest: ${error.message}`);
  }
}

export function validateFeatureManifest(manifest: FeatureManifest): void {
  if (!manifest.version) {
    throw new Error('Feature manifest must have a version');
  }
  
  if (!manifest.features || typeof manifest.features !== 'object') {
    throw new Error('Feature manifest must have a features object');
  }
  
  const featureNames = Object.keys(manifest.features);
  
  for (const [featureName, feature] of Object.entries(manifest.features)) {
    validateFeatureEntry(featureName, feature, featureNames);
  }
  
  validateFeatureDependencies(manifest.features);
}

function validateFeatureEntry(name: string, feature: FeatureEntry, allFeatures: string[]): void {
  if (!feature.description) {
    throw new Error(`Feature "${name}" must have a description`);
  }
  
  if (feature.dependencies) {
    if (!Array.isArray(feature.dependencies)) {
      throw new Error(`Feature "${name}" dependencies must be an array`);
    }
    
    for (const dependency of feature.dependencies) {
      if (!allFeatures.includes(dependency)) {
        throw new Error(`Feature "${name}" depends on unknown feature "${dependency}"`);
      }
    }
  }
  
  if (feature.exclusivePatterns && !Array.isArray(feature.exclusivePatterns)) {
    throw new Error(`Feature "${name}" exclusivePatterns must be an array`);
  }
  
  if (feature.sharedFiles && typeof feature.sharedFiles !== 'object') {
    throw new Error(`Feature "${name}" sharedFiles must be an object`);
  }
  
  if (feature.injectionPoints && typeof feature.injectionPoints !== 'object') {
    throw new Error(`Feature "${name}" injectionPoints must be an object`);
  }
}

function validateFeatureDependencies(features: Record<string, FeatureEntry>): void {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  
  function detectCircularDependency(featureName: string): void {
    if (visiting.has(featureName)) {
      throw new Error(`Circular dependency detected involving feature "${featureName}"`);
    }
    
    if (visited.has(featureName)) {
      return;
    }
    
    visiting.add(featureName);
    
    const feature = features[featureName];
    if (!feature) {
      return;
    }
    if (feature.dependencies) {
      for (const dependency of feature.dependencies) {
        detectCircularDependency(dependency);
      }
    }
    
    visiting.delete(featureName);
    visited.add(featureName);
  }
  
  for (const featureName of Object.keys(features)) {
    detectCircularDependency(featureName);
  }
}

export async function readProjectConfig(projectPath: string): Promise<ProjectConfig | null> {
  const configPath = join(projectPath, 'project-config.json');
  
  try {
    const content = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(content) as ProjectConfig;
    
    validateProjectConfig(config);
    return config;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw new Error(`Failed to read project config: ${error.message}`);
  }
}

export async function writeProjectConfig(projectPath: string, config: ProjectConfig): Promise<void> {
  const configPath = join(projectPath, 'project-config.json');
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function validateProjectConfig(config: ProjectConfig): void {
  if (!config.version) {
    throw new Error('Project config must have a version');
  }
  
  if (!Array.isArray(config.enabledFeatures)) {
    throw new Error('Project config must have enabledFeatures array');
  }
}

export function isFileFeatureExclusive(filePath: string, feature: FeatureEntry): boolean {
  if (!feature.exclusivePatterns) {
    return false;
  }
  
  return feature.exclusivePatterns.some(pattern => minimatch(filePath, pattern));
}

export function getFileFeatures(filePath: string, manifest: FeatureManifest): string[] {
  const features: string[] = [];
  
  for (const [featureName, feature] of Object.entries(manifest.features)) {
    if (isFileFeatureExclusive(filePath, feature)) {
      features.push(featureName);
    }
  }
  
  return features;
}

export function validateFeatureDependenciesForEnabledSet(
  enabledFeatures: string[], 
  manifest: FeatureManifest
): void {
  const enabledSet = new Set(enabledFeatures);
  
  for (const featureName of enabledFeatures) {
    const feature = manifest.features[featureName];
    if (!feature) {
      throw new Error(`Unknown feature: ${featureName}`);
    }
    
    if (feature.dependencies) {
      for (const dependency of feature.dependencies) {
        if (!enabledSet.has(dependency)) {
          throw new Error(`Feature "${featureName}" requires feature "${dependency}" to be enabled`);
        }
      }
    }
  }
}

export function resolveDependenciesForFeatures(
  requestedFeatures: string[], 
  manifest: FeatureManifest
): string[] {
  const resolved = new Set<string>();
  const toProcess = [...requestedFeatures];
  
  while (toProcess.length > 0) {
    const featureName = toProcess.pop()!;
    
    if (resolved.has(featureName)) {
      continue;
    }
    
    const feature = manifest.features[featureName];
    if (!feature) {
      throw new Error(`Unknown feature: ${featureName}`);
    }
    
    resolved.add(featureName);
    
    if (feature.dependencies) {
      toProcess.push(...feature.dependencies);
    }
  }
  
  return Array.from(resolved).sort();
}

export function canDisableFeature(
  featureToDisable: string,
  currentlyEnabled: string[],
  manifest: FeatureManifest
): { canDisable: boolean; dependentFeatures: string[] } {
  const dependentFeatures: string[] = [];
  
  for (const enabledFeature of currentlyEnabled) {
    if (enabledFeature === featureToDisable) {
      continue;
    }
    
    const feature = manifest.features[enabledFeature];
    if (!feature) {
      continue;
    }
    if (feature.dependencies?.includes(featureToDisable)) {
      dependentFeatures.push(enabledFeature);
    }
  }
  
  return {
    canDisable: dependentFeatures.length === 0,
    dependentFeatures
  };
}