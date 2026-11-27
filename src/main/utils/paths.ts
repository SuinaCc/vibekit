import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import {
  APP_DATA_DIR,
  PLUGINS_DIR_NAME,
  PLUGIN_DATA_DIR_NAME,
  CONFIG_DIR_NAME,
  CACHE_DIR_NAME,
} from '@shared';

// Resolves ~/.aero (cross-platform)
export function getAppDataDir(): string {
  const home = app.getPath('home');
  return path.join(home, APP_DATA_DIR);
}

export function getPluginsDir(): string {
  return path.join(getAppDataDir(), PLUGINS_DIR_NAME);
}

export function getPluginDataDir(): string {
  return path.join(getAppDataDir(), PLUGIN_DATA_DIR_NAME);
}

export function getConfigDir(): string {
  return path.join(getAppDataDir(), CONFIG_DIR_NAME);
}

export function getCacheDir(): string {
  return path.join(getAppDataDir(), CACHE_DIR_NAME);
}

export function getPluginDir(pluginId: string): string {
  return path.join(getPluginsDir(), pluginId);
}

export function getPluginDBPath(pluginId: string): string {
  return path.join(getPluginDataDir(), `${pluginId}.db`);
}

export function getConfigFilePath(): string {
  return path.join(getConfigDir(), 'app-config.json');
}

export function getPermissionsFilePath(): string {
  return path.join(getConfigDir(), 'permissions.json');
}

// Ensure all required directories exist on app startup
export function ensureAppDirectories(): void {
  const dirs = [
    getAppDataDir(),
    getPluginsDir(),
    getPluginDataDir(),
    getConfigDir(),
    getCacheDir(),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// Returns the path to built-in plugins (bundled with the app)
export function getBuiltinPluginsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'plugins');
  }
  return path.join(app.getAppPath(), 'plugins');
}
