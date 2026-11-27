import { PluginManifestSchema, type PluginManifest } from '../schemas/pluginManifest';
import type { PluginMeta } from '../types/plugin';

/**
 * Validates a plugin.json object against the schema.
 * Returns the parsed manifest or an error message.
 */
export function validatePluginManifest(
  raw: unknown
): { valid: true; manifest: PluginManifest } | { valid: false; errors: string[] } {
  const result = PluginManifestSchema.safeParse(raw);
  if (result.success) {
    return { valid: true, manifest: result.data };
  }
  const errors = result.error.issues.map(
    (issue) => `${issue.path.join('.')}: ${issue.message}`
  );
  return { valid: false, errors };
}

/**
 * Converts a validated PluginManifest to a PluginMeta
 * (the in-memory representation used by the plugin registry).
 */
export function manifestToPluginMeta(manifest: PluginManifest): PluginMeta {
  return {
    id: manifest.id,
    name: manifest.name,
    desc: manifest.desc,
    version: manifest.version,
    author: manifest.author,
    icon: manifest.icon,
    keywords: manifest.keywords,
    category: manifest.category,
    permissions: manifest.permissions,
    minAppVersion: manifest.minAppVersion,
    windowWidth: manifest.windowWidth,
    windowHeight: manifest.windowHeight,
  };
}
