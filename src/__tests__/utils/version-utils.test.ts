import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compareVersions, getCurrentVersion, getLatestVersion } from '../../utils/version-utils';

describe('version-utils', () => {
  describe('compareVersions', () => {
    it('should return "same" for identical versions', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe('same');
      expect(compareVersions('2.5.3', '2.5.3')).toBe('same');
    });

    it('should return "older" when current is older than latest', () => {
      expect(compareVersions('1.0.0', '1.0.1')).toBe('older');
      expect(compareVersions('1.0.0', '1.1.0')).toBe('older');
      expect(compareVersions('1.0.0', '2.0.0')).toBe('older');
      expect(compareVersions('1.2.3', '1.2.4')).toBe('older');
    });

    it('should return "newer" when current is newer than latest', () => {
      expect(compareVersions('1.0.1', '1.0.0')).toBe('newer');
      expect(compareVersions('1.1.0', '1.0.0')).toBe('newer');
      expect(compareVersions('2.0.0', '1.0.0')).toBe('newer');
      expect(compareVersions('1.2.4', '1.2.3')).toBe('newer');
    });

    it('should handle version strings with different lengths', () => {
      expect(compareVersions('1.0', '1.0.0')).toBe('same');
      expect(compareVersions('1.0.0', '1.0')).toBe('same');
      expect(compareVersions('1.0', '1.0.1')).toBe('older');
      expect(compareVersions('1.0.1', '1.0')).toBe('newer');
    });

    it('should return "same" for unknown current version', () => {
      expect(compareVersions('unknown', '1.0.0')).toBe('same');
      expect(compareVersions('unknown', '2.5.3')).toBe('same');
    });
  });

  describe('getCurrentVersion', () => {
    it('should return the version from package.json', () => {
      const version = getCurrentVersion();
      expect(typeof version).toBe('string');
      expect(version.length).toBeGreaterThan(0);
      // Should match semantic versioning pattern or be 'unknown'
      expect(version === 'unknown' || /^\d+\.\d+\.\d+/.test(version)).toBe(true);
    });
  });

  describe('getLatestVersion', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it('should return latest version from GitHub API', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          tag_name: 'v1.2.3',
          name: 'Release v1.2.3',
          published_at: '2023-01-01T00:00:00Z'
        })
      };
      
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as any);

      const version = await getLatestVersion();
      expect(version).toBe('1.2.3');
    });

    it('should strip v prefix from tag name', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          tag_name: 'v2.0.0',
          name: 'Release v2.0.0',
          published_at: '2023-01-01T00:00:00Z'
        })
      };
      
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as any);

      const version = await getLatestVersion();
      expect(version).toBe('2.0.0');
    });

    it('should handle tag names without v prefix', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          tag_name: '1.5.0',
          name: 'Release 1.5.0',
          published_at: '2023-01-01T00:00:00Z'
        })
      };
      
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as any);

      const version = await getLatestVersion();
      expect(version).toBe('1.5.0');
    });

    it('should return null when API request fails', async () => {
      const mockResponse = {
        ok: false,
        status: 404
      };
      
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as any);

      const version = await getLatestVersion();
      expect(version).toBeNull();
    });

    it('should return null when network error occurs', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

      const version = await getLatestVersion();
      expect(version).toBeNull();
    });

    it('should use correct GitHub API endpoint and headers', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          tag_name: 'v1.0.0',
          name: 'Release v1.0.0',
          published_at: '2023-01-01T00:00:00Z'
        })
      };
      
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as any);

      await getLatestVersion();

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/timoconnellaus/template-cli/releases/latest',
        {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'template-cli-version-checker'
          }
        }
      );
    });
  });
});