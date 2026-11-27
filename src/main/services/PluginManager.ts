import * as fs from 'fs';
import * as path from 'path';
import { getPluginsDir, getPluginDir } from '../utils/paths';
import { validatePluginManifest, manifestToPluginMeta } from '@shared';
import { BUILTIN_TOOL_IDS } from '@shared/builtinTools';
import type { PluginMeta } from '@shared';
import type { ConfigService } from './ConfigService';

export class PluginManager {
  private plugins: Map<string, PluginMeta> = new Map();
  private configService: ConfigService;

  constructor(configService: ConfigService) {
    this.configService = configService;
  }

  // Scan the plugins directory and register all valid plugins
  async scanPlugins(): Promise<PluginMeta[]> {
    const pluginsDir = getPluginsDir();

    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
      return [];
    }

    this.plugins.clear();
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    const plugins: PluginMeta[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      if (BUILTIN_TOOL_IDS.has(entry.name)) continue;

      const pluginDir = path.join(pluginsDir, entry.name);
      const manifestPath = path.join(pluginDir, 'plugin.json');

      if (!fs.existsSync(manifestPath)) {
        console.warn(`Plugin ${entry.name} missing plugin.json, skipping`);
        continue;
      }

      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const result = validatePluginManifest(raw);

        if (result.valid) {
          const meta = manifestToPluginMeta(result.manifest);
          if (BUILTIN_TOOL_IDS.has(meta.id)) continue;
          const config = this.configService.get();
          if (!config.plugins.disabled.includes(meta.id)) {
            this.plugins.set(meta.id, meta);
            plugins.push(meta);
          }
        } else {
          console.warn(`Plugin ${entry.name} has invalid manifest:`, result.errors);
        }
      } catch (err) {
        console.warn(`Failed to load plugin ${entry.name}:`, err);
      }
    }

    console.log(`PluginManager: loaded ${plugins.length} plugins`);
    return plugins;
  }

  getAllPlugins(): PluginMeta[] {
    return Array.from(this.plugins.values());
  }

  getPlugin(id: string): PluginMeta | undefined {
    return this.plugins.get(id);
  }

  enablePlugin(pluginId: string): boolean {
    const config = this.configService.get();
    const disabled = config.plugins.disabled.filter((id) => id !== pluginId);
    this.configService.setValue('plugins.disabled', disabled);
    void this.scanPlugins();
    return true;
  }

  disablePlugin(pluginId: string): boolean {
    const config = this.configService.get();
    if (!config.plugins.disabled.includes(pluginId)) {
      config.plugins.disabled.push(pluginId);
      this.configService.setValue('plugins.disabled', config.plugins.disabled);
      this.plugins.delete(pluginId);
    }
    return true;
  }

  uninstallPlugin(pluginId: string): boolean {
    const pluginDir = getPluginDir(pluginId);
    try {
      if (fs.existsSync(pluginDir)) {
        fs.rmSync(pluginDir, { recursive: true, force: true });
      }
      this.plugins.delete(pluginId);
      return true;
    } catch (err) {
      console.error(`Failed to uninstall plugin ${pluginId}:`, err);
      return false;
    }
  }
}
