import { BrowserWindow } from 'electron';
import { PLUGIN_EVENTS, type PluginEventRoute } from '@shared/pluginEvents';
import type { PermissionsService } from './PermissionsService';
import type { WindowManager } from '../windows/WindowManager';

export class EventRouter {
  constructor(
    private windowManager: WindowManager,
    private permissionsService: PermissionsService,
  ) {}

  emit(event: string, payload: unknown, options?: { windowId?: number }): void {
    const route = PLUGIN_EVENTS.find((item) => item.event === event);
    if (!route) return;

    if (options?.windowId != null) {
      this.sendToWindow(options.windowId, route, payload);
      return;
    }

    if (route.scope !== 'all-plugin-windows') return;

    for (const { id, pluginId } of this.windowManager.getPluginWindows()) {
      if (!this.permissionsService.has(pluginId, route.permission)) continue;
      this.sendToWindow(id, route, payload);
    }
  }

  private sendToWindow(windowId: number, route: PluginEventRoute, payload: unknown): void {
    const pluginId = this.windowManager.getPluginIdForWindow(windowId);
    if (!pluginId) return;
    if (!this.permissionsService.has(pluginId, route.permission)) return;

    const win = BrowserWindow.fromId(windowId);
    if (win && !win.isDestroyed()) {
      win.webContents.send('aero:bridge-event', { event: route.event, payload });
    }
  }
}
