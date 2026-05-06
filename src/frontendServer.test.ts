import { describe, expect, it } from 'bun:test';
import { getMainFrontendAssetPath } from './frontendServer';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('getMainFrontendAssetPath', () => {
  it('resolves existing build assets within the build directory', () => {
    const tempBuildPath = mkdtempSync(join(tmpdir(), 'frontend-server-test-'));
    const assetPath = join(tempBuildPath, 'frontend.js');
    writeFileSync(assetPath, 'console.log("ok");');

    try {
      expect(getMainFrontendAssetPath('/frontend.js', tempBuildPath)).toBe(assetPath);
    } finally {
      rmSync(tempBuildPath, { recursive: true, force: true });
    }
  });

  it('returns null for paths outside the build directory', () => {
    const tempBuildPath = mkdtempSync(join(tmpdir(), 'frontend-server-test-'));
    try {
      expect(getMainFrontendAssetPath('/../frontend.js', tempBuildPath)).toBeNull();
      expect(getMainFrontendAssetPath('/safe/../../etc/passwd', tempBuildPath)).toBeNull();
    } finally {
      rmSync(tempBuildPath, { recursive: true, force: true });
    }
  });

  it('returns null for directory-style requests and non-existent files', () => {
    const tempBuildPath = mkdtempSync(join(tmpdir(), 'frontend-server-test-'));
    try {
      expect(getMainFrontendAssetPath('/assets/', tempBuildPath)).toBeNull();
      expect(getMainFrontendAssetPath('/missing.js', tempBuildPath)).toBeNull();
    } finally {
      rmSync(tempBuildPath, { recursive: true, force: true });
    }
  });
});
