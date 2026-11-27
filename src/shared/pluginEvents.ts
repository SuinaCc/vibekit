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
// `window.aero.events.onX(cb)` is generated from this table.
export const PLUGIN_EVENTS: readonly PluginEventRoute[] = [
  { event: 'aero:scanProgress', namespace: 'files', name: 'onScanProgress', scope: 'owning-window' },
  { event: 'aero:cleanProgress', namespace: 'files', name: 'onCleanProgress', scope: 'owning-window' },
  { event: 'aero:lanDevices', namespace: 'lan', name: 'onDevices', permission: 'lan', scope: 'all-plugin-windows' },
  { event: 'aero:lanIncoming', namespace: 'lan', name: 'onIncoming', permission: 'lan', scope: 'all-plugin-windows' },
  { event: 'aero:lanProgress', namespace: 'lan', name: 'onProgress', permission: 'lan', scope: 'all-plugin-windows' },
  { event: 'aero:lanComplete', namespace: 'lan', name: 'onComplete', permission: 'lan', scope: 'all-plugin-windows' },
  { event: 'aero:lanError', namespace: 'lan', name: 'onError', permission: 'lan', scope: 'all-plugin-windows' },
  { event: 'aero:voiceStatus', namespace: 'voice', name: 'onStatus', permission: 'network', scope: 'all-plugin-windows' },
  { event: 'aero:voiceTranscript', namespace: 'voice', name: 'onTranscript', permission: 'network', scope: 'all-plugin-windows' },
  { event: 'aero:webState', namespace: 'web', name: 'onState', permission: 'network', scope: 'all-plugin-windows' },
  { event: 'aero:pomodoroState', namespace: 'pomodoro', name: 'onPomodoroState', scope: 'owning-window' },
  { event: 'aero:pomodoroReminder', namespace: 'pomodoro', name: 'onPomodoroReminder', scope: 'owning-window' },
  { event: 'aero:netSpeedProgress', namespace: 'net', name: 'onNetSpeedProgress', permission: 'network', scope: 'owning-window' },
];
