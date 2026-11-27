import { nativeTheme } from 'electron';
import { platform, release } from 'os';

export function isWindows(): boolean {
  return platform() === 'win32';
}

export function isMacOS(): boolean {
  return platform() === 'darwin';
}

// Detect if we're on Windows 10 or later (needed for the CSS fallback)
export function isWindows10OrLater(): boolean {
  if (!isWindows()) return false;
  const version = release();
  const major = parseInt(version.split('.')[0], 10);
  return major >= 10;
}

// Windows 11 22H2+ (build 22621) is the supported acrylic/mica baseline.
export function isWindows11OrLater(): boolean {
  if (!isWindows()) return false;
  const parts = release().split('.').map((part) => parseInt(part, 10));
  const build = parts[2] || 0;
  return build >= 22621;
}

export function prefersReducedTransparency(): boolean {
  return nativeTheme.prefersReducedTransparency;
}

export function canUseMica(): boolean {
  return isWindows11OrLater() && !prefersReducedTransparency();
}

export function canUseAcrylic(): boolean {
  return isWindows11OrLater() && !prefersReducedTransparency();
}

// Check if we can use native window blur
export function canUseNativeBlur(): boolean {
  if (isMacOS()) return true;
  if (isWindows() && isWindows10OrLater()) return true;
  return false;
}
