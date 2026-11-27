import type { PermissionType } from '@shared';
import type { ConfigService } from './ConfigService';
import type { PluginManager } from './PluginManager';

export class PermissionsService {
  constructor(
    private pluginManager: PluginManager,
    private configService: ConfigService,
  ) {}

  assert(pluginId: string, permission: PermissionType): void {
    const meta = this.pluginManager.getPlugin(pluginId);
    if (!meta) throw new Error(`插件未找到: ${pluginId}`);
    if (!meta.permissions.includes(permission)) {
      throw new Error(`插件未声明权限: ${permission}`);
    }
    const state = this.configService.getPluginPermissions()[pluginId]?.[permission];
    if (state === 'denied') {
      throw new Error(`权限被拒绝: ${permission}`);
    }
  }

  has(pluginId: string, permission?: PermissionType): boolean {
    if (!permission) return true;
    try {
      this.assert(pluginId, permission);
      return true;
    } catch {
      return false;
    }
  }
}
