import type { AeroRendererApi, PermissionState, PluginMeta } from '@shared';
import { PLUGIN_METHODS_BY_NAME, type PluginMethod } from '@shared/pluginMethods';

export interface PluginPermissionContext {
  plugin: PluginMeta;
  states: Record<string, PermissionState>;
}

// Loaded once per plugin window. Plugin enable/disable closes the window, so the
// context can never outlive a permission change by more than one window.
export async function loadPluginPermissionContext(
  api: AeroRendererApi,
  pluginId: string,
): Promise<PluginPermissionContext | null> {
  try {
    const [plugins, states] = await Promise.all([
      api.plugin.list(),
      api.plugin.getPermissions(pluginId),
    ]);
    const plugin = plugins.find((item) => item.id === pluginId);
    return plugin ? { plugin, states } : null;
  } catch {
    return null;
  }
}

async function assertPermission(
  api: AeroRendererApi,
  pluginId: string,
  method: PluginMethod,
  context: PluginPermissionContext | null | undefined,
): Promise<void> {
  const permission = method.permission;
  if (!permission) return;

  let meta: PluginMeta | undefined;
  let states: Record<string, PermissionState>;
  if (context) {
    meta = context.plugin;
    states = context.states;
  } else {
    const [plugins, permissions] = await Promise.all([
      api.plugin.list(),
      api.plugin.getPermissions(pluginId),
    ]);
    meta = plugins.find((plugin) => plugin.id === pluginId);
    states = permissions;
  }

  if (!meta) throw new Error(`插件未找到: ${pluginId}`);
  if (!meta.permissions.includes(permission)) {
    throw new Error(`插件未声明权限: ${permission}（已声明: ${meta.permissions.join(',') || '无'}）`);
  }
  if (states[permission] === 'denied') {
    throw new Error(`权限被拒绝: ${permission}`);
  }
}

export async function dispatchPluginMethod(
  api: AeroRendererApi,
  pluginId: string,
  methodName: string,
  params: Record<string, any>,
  context?: PluginPermissionContext | null,
): Promise<unknown> {
  const method = PLUGIN_METHODS_BY_NAME.get(methodName);
  if (!method) throw new Error(`Unknown method: ${methodName}`);
  await assertPermission(api, pluginId, method, context);
  return method.invoke(api, params ?? {}, pluginId);
}
