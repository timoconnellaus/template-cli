import { promises as fs } from 'fs';
import { join } from 'path';
import { 
  type FeatureManifest, 
  getFileFeatures, 
  isFileFeatureExclusive 
} from './feature-utils.js';

export interface FeatureMigrationEntry {
  type: 'new' | 'delete' | 'modify' | 'moved' | 'binary';
  path?: string;
  oldPath?: string;
  newPath?: string;
  diffFile?: string;
  isBinary?: boolean;
  featureExclusive?: string;
  features?: Record<string, string>;
}

export interface FeatureMigration {
  [key: string]: FeatureMigrationEntry;
}

export interface SkippedMigration {
  name: string;
  reason: string;
  timestamp?: string;
}

export function shouldApplyMigrationEntry(
  entry: FeatureMigrationEntry,
  enabledFeatures: string[]
): boolean {
  if (entry.featureExclusive) {
    return enabledFeatures.includes(entry.featureExclusive);
  }
  
  if (entry.features && Object.keys(entry.features).length > 0) {
    const availableFeatures = Object.keys(entry.features);
    const hasEnabledFeature = availableFeatures.some(feature => 
      feature === '_base' || enabledFeatures.includes(feature)
    );
    return hasEnabledFeature;
  }
  
  return true;
}

export function filterMigrationByFeatures(
  migration: FeatureMigration,
  enabledFeatures: string[]
): { 
  applicableMigration: FeatureMigration; 
  skippedEntries: Array<{ key: string; reason: string }> 
} {
  const applicableMigration: FeatureMigration = {};
  const skippedEntries: Array<{ key: string; reason: string }> = [];
  
  for (const [key, entry] of Object.entries(migration)) {
    if (shouldApplyMigrationEntry(entry, enabledFeatures)) {
      applicableMigration[key] = entry;
    } else {
      let reason = 'unknown feature requirements';
      
      if (entry.featureExclusive) {
        reason = `feature:${entry.featureExclusive} not enabled`;
      } else if (entry.features) {
        const requiredFeatures = Object.keys(entry.features).filter(f => f !== '_base');
        reason = `features not enabled: ${requiredFeatures.join(', ')}`;
      }
      
      skippedEntries.push({ key, reason });
    }
  }
  
  return { applicableMigration, skippedEntries };
}

export function detectFeatureAssociations(
  filePath: string,
  manifest: FeatureManifest | null
): string[] {
  if (!manifest) {
    return [];
  }
  
  return getFileFeatures(filePath, manifest);
}

export function createFeatureMigrationEntry(
  type: 'new' | 'delete' | 'modify' | 'moved' | 'binary',
  path: string,
  manifest: FeatureManifest | null,
  additionalProps: Partial<FeatureMigrationEntry> = {}
): FeatureMigrationEntry {
  const entry: FeatureMigrationEntry = {
    type,
    path,
    ...additionalProps
  };
  
  if (manifest) {
    const associatedFeatures = detectFeatureAssociations(path, manifest);
    
    if (associatedFeatures.length === 1) {
      entry.featureExclusive = associatedFeatures[0];
    } else if (associatedFeatures.length > 1) {
      entry.features = {};
      for (const feature of associatedFeatures) {
        entry.features[feature] = additionalProps.diffFile || '';
      }
    }
  }
  
  return entry;
}

export function getFeatureSpecificDiff(
  entry: FeatureMigrationEntry,
  enabledFeatures: string[]
): string | null {
  if (!entry.features) {
    return entry.diffFile || null;
  }
  
  for (const feature of enabledFeatures) {
    if (entry.features[feature]) {
      return entry.features[feature];
    }
  }
  
  return entry.features['_base'] || null;
}

export async function readFeatureMigrationFromPath(
  migrationPath: string
): Promise<{ migration: FeatureMigration; hasFeatureSupport: boolean }> {
  const migrationFilePath = join(migrationPath, 'migrate.ts');
  const content = await fs.readFile(migrationFilePath, 'utf8');
  
  const match = content.match(/export const migration = \{(.*)\} as const;/s);
  if (!match || !match[1]) {
    throw new Error('Could not parse migration file');
  }
  
  const migrationContent = `{${match[1]}}`;
  
  try {
    const migration = eval(`(${migrationContent})`) as FeatureMigration;
    
    const hasFeatureSupport = Object.values(migration).some(entry => 
      entry.featureExclusive || entry.features
    );
    
    return { migration, hasFeatureSupport };
  } catch (error) {
    throw new Error(`Could not parse migration content: ${error}`);
  }
}

export async function writeFeatureMigrationFile(
  filePath: string, 
  migration: FeatureMigration
): Promise<void> {
  const formatMigrationEntry = (entry: FeatureMigrationEntry): string => {
    return JSON.stringify(entry, null, 2).replace(/\n/g, '\n  ');
  };

  const migrationEntries = Object.entries(migration).map(([key, value]) => {
    const formattedValue = formatMigrationEntry(value);
    return `  "${key}": ${formattedValue}`;
  }).join(',\n');

  const migrationContent = `// Migration generated automatically
export const migration = {
${migrationEntries}
} as const;
`;
  
  await fs.writeFile(filePath, migrationContent, 'utf8');
}

export function getMigrationFeatureRequirements(migration: FeatureMigration): string[] {
  const requiredFeatures = new Set<string>();
  
  for (const entry of Object.values(migration)) {
    if (entry.featureExclusive) {
      requiredFeatures.add(entry.featureExclusive);
    }
    
    if (entry.features) {
      for (const feature of Object.keys(entry.features)) {
        if (feature !== '_base') {
          requiredFeatures.add(feature);
        }
      }
    }
  }
  
  return Array.from(requiredFeatures).sort();
}

export function canApplyMigration(
  migration: FeatureMigration,
  enabledFeatures: string[]
): { canApply: boolean; missingFeatures: string[] } {
  const requiredFeatures = getMigrationFeatureRequirements(migration);
  const enabledSet = new Set(enabledFeatures);
  const missingFeatures = requiredFeatures.filter(feature => !enabledSet.has(feature));
  
  return {
    canApply: missingFeatures.length === 0,
    missingFeatures
  };
}

export function extractFeatureFilesFromMigration(
  migration: FeatureMigration,
  enabledFeatures: string[]
): Record<string, string[]> {
  const featureFiles: Record<string, string[]> = {};
  
  for (const [key, entry] of Object.entries(migration)) {
    if (!shouldApplyMigrationEntry(entry, enabledFeatures)) {
      continue;
    }
    
    if (entry.featureExclusive && entry.type === 'new') {
      const feature = entry.featureExclusive;
      if (!featureFiles[feature]) {
        featureFiles[feature] = [];
      }
      featureFiles[feature].push(entry.path || key);
    }
  }
  
  return featureFiles;
}

export function isFeatureContentBlock(line: string): {
  isBlock: boolean;
  feature?: string;
  isStart?: boolean;
  isEnd?: boolean;
} {
  const startMatch = line.match(/\/\/\s*@feature:([^:]+):start/);
  if (startMatch) {
    return { isBlock: true, feature: startMatch[1], isStart: true };
  }
  
  const endMatch = line.match(/\/\/\s*@feature:([^:]+):end/);
  if (endMatch) {
    return { isBlock: true, feature: endMatch[1], isEnd: true };
  }
  
  return { isBlock: false };
}

export function isInjectionPoint(line: string): {
  isInjectionPoint: boolean;
  pointName?: string;
} {
  const match = line.match(/\/\/\s*@inject-point:([^\s]+)/);
  if (match) {
    return { isInjectionPoint: true, pointName: match[1] };
  }
  
  return { isInjectionPoint: false };
}

export function processFeatureConditionalContent(
  content: string,
  enabledFeatures: string[]
): string {
  const lines = content.split('\n');
  const result: string[] = [];
  const featureStack: string[] = [];
  const enabledSet = new Set(enabledFeatures);
  
  for (const line of lines) {
    const blockInfo = isFeatureContentBlock(line);
    
    if (blockInfo.isBlock) {
      if (blockInfo.isStart && blockInfo.feature) {
        featureStack.push(blockInfo.feature);
        continue;
      } else if (blockInfo.isEnd && blockInfo.feature) {
        if (featureStack.length > 0 && featureStack[featureStack.length - 1] === blockInfo.feature) {
          featureStack.pop();
        }
        continue;
      }
    }
    
    const shouldInclude = featureStack.length === 0 || 
                         featureStack.every(feature => enabledSet.has(feature));
    
    if (shouldInclude) {
      result.push(line);
    }
  }
  
  return result.join('\n');
}