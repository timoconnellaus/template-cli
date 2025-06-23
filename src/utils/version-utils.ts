import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getCurrentVersion(): string {
  try {
    // Try multiple possible paths for package.json
    const possiblePaths = [
      join(__dirname, '../../package.json'), // When running from src/
      join(__dirname, '../package.json'),    // When built to dist/
    ];
    
    for (const packageJsonPath of possiblePaths) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        return packageJson.version;
      } catch {
        continue;
      }
    }
    
    throw new Error('package.json not found in any expected location');
  } catch (error) {
    console.warn('⚠️ Could not read current version from package.json');
    return 'unknown';
  }
}

export async function getLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch('https://api.github.com/repos/timoconnellaus/template-cli/releases/latest', {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'template-cli-version-checker'
      }
    });

    if (!response.ok) {
      return null;
    }

    const release: GitHubRelease = await response.json();
    return release.tag_name.replace(/^v/, ''); // Remove 'v' prefix if present
  } catch (error) {
    // Silently fail for network issues
    return null;
  }
}

export function compareVersions(current: string, latest: string): 'newer' | 'same' | 'older' {
  if (current === 'unknown') return 'same'; // Don't warn if we can't determine current version
  
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);
  
  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const currentPart = currentParts[i] || 0;
    const latestPart = latestParts[i] || 0;
    
    if (currentPart > latestPart) return 'newer';
    if (currentPart < latestPart) return 'older';
  }
  
  return 'same';
}

export async function checkForUpdates(): Promise<void> {
  const currentVersion = getCurrentVersion();
  const latestVersion = await getLatestVersion();
  
  if (!latestVersion) {
    // Silently fail if we can't check for updates
    return;
  }
  
  const comparison = compareVersions(currentVersion, latestVersion);
  
  if (comparison === 'older') {
    console.log(`\n📦 Update available! Current: v${currentVersion}, Latest: v${latestVersion}`);
    console.log(`   Run: npm update -g @timoaus/template-cli\n`);
  }
}