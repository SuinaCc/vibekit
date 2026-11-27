import * as fs from 'fs';
import * as path from 'path';
import { getConfigFilePath, getPermissionsFilePath, getConfigDir } from '../utils/paths';
import { DEFAULT_CONFIG, AppConfigSchema, type AppConfigParsed } from '@shared';

export class ConfigService {
  private config: AppConfigParsed;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): AppConfigParsed {
    const configPath = getConfigFilePath();
    const existed = fs.existsSync(configPath);
    try {
      if (existed) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const result = AppConfigSchema.safeParse(parsed);
        if (result.success) {
          return result.data;
        }
        console.warn('Config validation failed, using in-memory defaults:', result.error.issues);
      }
    } catch (err) {
      console.warn('Failed to load config, using defaults:', err);
    }
    // Never overwrite an existing config that failed validation.
    const defaults = AppConfigSchema.parse(DEFAULT_CONFIG);
    if (!existed) this.saveConfig(defaults);
    return defaults;
  }

  private saveConfig(config: AppConfigParsed): void {
    const configPath = getConfigFilePath();
    const configDir = getConfigDir();
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    // Atomic write: write to temp, then rename
    const tmpPath = configPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(tmpPath, configPath);
  }

  get(): AppConfigParsed {
    return this.config;
  }

  getValue<T = unknown>(dotPath?: string): T {
    if (!dotPath) return this.config as unknown as T;
    const parts = dotPath.split('.');
    let current: unknown = this.config;
    for (const part of parts) {
      if (current && typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined as unknown as T;
      }
    }
    return current as T;
  }

  setValue(dotPath: string, value: unknown): void {
    const result = AppConfigSchema.safeParse(this.config);
    if (!result.success) return;

    const parts = dotPath.split('.');
    let current: Record<string, unknown> = this.config as unknown as Record<string, unknown>;

    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current)) {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;

    // Re-validate after modification
    const validated = AppConfigSchema.safeParse(this.config);
    if (validated.success) {
      this.config = validated.data;
      this.saveConfig(this.config);
    }
  }

  reset(): void {
    this.config = AppConfigSchema.parse(DEFAULT_CONFIG);
    this.saveConfig(this.config);
  }

  // Plugin permissions are stored separately for faster access
  getPluginPermissions(): Record<string, Record<string, 'ask' | 'granted' | 'denied'>> {
    const permsPath = getPermissionsFilePath();
    try {
      if (fs.existsSync(permsPath)) {
        return JSON.parse(fs.readFileSync(permsPath, 'utf-8'));
      }
    } catch {
      // ignore
    }
    return {};
  }

  savePluginPermissions(
    permissions: Record<string, Record<string, 'ask' | 'granted' | 'denied'>>
  ): void {
    const permsPath = getPermissionsFilePath();
    const tmpPath = permsPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(permissions, null, 2), 'utf-8');
    fs.renameSync(tmpPath, permsPath);
  }

  exportAll(): string {
    return JSON.stringify(
      {
        config: this.config,
        permissions: this.getPluginPermissions(),
        exportedAt: new Date().toISOString(),
      },
      null,
      2
    );
  }

  importAll(json: string): void {
    const data = JSON.parse(json);
    if (data.config) {
      const validated = AppConfigSchema.safeParse(data.config);
      if (validated.success) {
        this.config = validated.data;
        this.saveConfig(this.config);
      }
    }
    if (data.permissions) {
      this.savePluginPermissions(data.permissions);
    }
  }
}
