import type { PermissionType } from './types/permissions';

export type PluginEventScope = 'owning-window' | 'all-plugin-windows';

export interface PluginEventRoute {
  event: string;
  namespace: string;
  name: string;
  permission?: PermissionType;
  scope: PluginEventScope;
}

// Push events are routed by main to plugin windows that declared the permission.
// `window.vibekit.events.onX(cb)` is generated from this table.
export const PLUGIN_EVENTS: readonly PluginEventRoute[] = [
  { event: 'vibekit:scanProgress', namespace: 'files', name: 'onScanProgress', scope: 'owning-window' },
  { event: 'vibekit:cleanProgress', namespace: 'files', name: 'onCleanProgress', scope: 'owning-window' },
  { event: 'vibekit:lanDevices', namespace: 'lan', name: 'onDevices', permission: 'lan', scope: 'all-plugin-windows' },
  { event: 'vibekit:lanIncoming', namespace: 'lan', name: 'onIncoming', permission: 'lan', scope: 'all-plugin-windows' },
  { event: 'vibekit:lanProgress', namespace: 'lan', name: 'onProgress', permission: 'lan', scope: 'all-plugin-windows' },
  { event: 'vibekit:lanComplete', namespace: 'lan', name: 'onComplete', permission: 'lan', scope: 'all-plugin-windows' },
  { event: 'vibekit:lanError', namespace: 'lan', name: 'onError', permission: 'lan', scope: 'all-plugin-windows' },
  { event: 'vibekit:voiceStatus', namespace: 'voice', name: 'onStatus', permission: 'network', scope: 'all-plugin-windows' },
  { event: 'vibekit:voiceTranscript', namespace: 'voice', name: 'onTranscript', permission: 'network', scope: 'all-plugin-windows' },
  { event: 'vibekit:webState', namespace: 'web', name: 'onState', permission: 'network', scope: 'all-plugin-windows' },
  { event: 'vibekit:pomodoroState', namespace: 'pomodoro', name: 'onPomodoroState', scope: 'owning-window' },
  { event: 'vibekit:pomodoroReminder', namespace: 'pomodoro', name: 'onPomodoroReminder', scope: 'owning-window' },
  { event: 'vibekit:netSpeedProgress', namespace: 'net', name: 'onNetSpeedProgress', permission: 'network', scope: 'owning-window' },
  { event: 'vibekit:invoiceProgress', namespace: 'invoice', name: 'onProgress', scope: 'owning-window' },
];
