import type { AeroRendererApi } from './types/api';
import type { PermissionType } from './types/permissions';

export interface PluginBridgeMethod {
  namespace: string;
  name: string;
  params: string[];
}

export interface PluginMethod {
  method: string;
  permission?: PermissionType;
  bridge?: PluginBridgeMethod;
  invoke(api: AeroRendererApi, params: Record<string, any>, pluginId: string): Promise<unknown>;
}

// The single source of truth for the Bridge API:
// method name, required permission, generated window.aero surface, and renderer handler.
export const PLUGIN_METHODS: readonly PluginMethod[] = [
  {
    method: 'clipboard:read',
    permission: 'clipboard',
    bridge: { namespace: 'clipboard', name: 'read', params: [] },
    invoke: (api) => api.system.readClipboard(),
  },
  {
    method: 'clipboard:write',
    permission: 'clipboard',
    bridge: { namespace: 'clipboard', name: 'write', params: ['text'] },
    invoke: (api, params) => api.system.writeClipboard(params.text),
  },
  {
    method: 'clipboard:history',
    permission: 'clipboard',
    bridge: { namespace: 'clipboard', name: 'history', params: [] },
    invoke: async (api) => {
      const history = await api.system.getClipboardHistory();
      return Promise.all(history.map(async (item) => {
        if (item.type === 'image' && item.text) {
          const dataUrl = await api.system.readFileAsDataUrl(item.text);
          if (dataUrl) return { ...item, text: dataUrl };
        }
        return item;
      }));
    },
  },
  {
    method: 'clipboard:clear',
    permission: 'clipboard',
    bridge: { namespace: 'clipboard', name: 'clear', params: [] },
    invoke: (api) => api.system.clearClipboardHistory(),
  },
  {
    method: 'file:read',
    permission: 'file-read',
    bridge: { namespace: 'file', name: 'read', params: ['path'] },
    invoke: (api, params, pluginId) => api.system.readFile(params.path, pluginId),
  },
  {
    method: 'file:write',
    permission: 'file-write',
    bridge: { namespace: 'file', name: 'write', params: ['path', 'data'] },
    invoke: (api, params, pluginId) => api.system.writeFile(params.path, params.data, pluginId),
  },
  {
    method: 'file:select',
    permission: 'file-read',
    bridge: { namespace: 'file', name: 'select', params: ['options'] },
    invoke: (api, params) => api.system.selectFile(params.options),
  },
  {
    method: 'file:selectFolder',
    permission: 'file-read',
    bridge: { namespace: 'file', name: 'selectFolder', params: [] },
    invoke: (api) => api.system.selectFolder(),
  },
  {
    method: 'file:readDataUrl',
    permission: 'file-read',
    bridge: { namespace: 'file', name: 'readDataUrl', params: ['path'] },
    invoke: (api, params) => api.system.readFileAsDataUrl(params.path),
  },
  {
    method: 'file:scanDir',
    permission: 'file-read',
    bridge: { namespace: 'file', name: 'scanDir', params: ['path'] },
    invoke: (api, params) => api.system.scanDirectory(params.path),
  },
  {
    method: 'file:trashItem',
    permission: 'file-write',
    bridge: { namespace: 'file', name: 'trashItem', params: ['path'] },
    invoke: (api, params) => api.system.trashItem(params.path),
  },
  {
    method: 'file:emptyDir',
    permission: 'file-write',
    bridge: { namespace: 'file', name: 'emptyDir', params: ['path'] },
    invoke: (api, params) => api.system.emptyDir(params.path),
  },
  {
    method: 'file:scanLarge',
    permission: 'file-read',
    bridge: { namespace: 'file', name: 'scanLarge', params: ['threshold'] },
    invoke: (api, params) => api.system.scanLargeFiles(params.threshold),
  },
  {
    method: 'file:getSize',
    permission: 'file-read',
    bridge: { namespace: 'file', name: 'getSize', params: ['path'] },
    invoke: (api, params) => api.system.getDirSize(params.path),
  },
  {
    method: 'shell:openPath',
    permission: 'file-read',
    bridge: { namespace: 'shell', name: 'openPath', params: ['path'] },
    invoke: (api, params) => api.system.openPath(params.path),
  },
  {
    method: 'env:get',
    bridge: { namespace: 'system', name: 'getEnv', params: [] },
    invoke: (api) => api.system.getEnv(),
  },
  {
    method: 'disk:info',
    permission: 'file-read',
    bridge: { namespace: 'system', name: 'diskInfo', params: ['drivePath'] },
    invoke: (api, params) => api.system.getDiskInfo(params.drivePath),
  },
  {
    method: 'storage:get',
    bridge: { namespace: 'storage', name: 'get', params: ['key'] },
    invoke: (api, params, pluginId) => api.plugin.getData(pluginId, params.key),
  },
  {
    method: 'storage:set',
    bridge: { namespace: 'storage', name: 'set', params: ['key', 'value'] },
    invoke: (api, params, pluginId) => api.plugin.setData(pluginId, params.key, params.value),
  },
  {
    method: 'storage:delete',
    bridge: { namespace: 'storage', name: 'delete', params: ['key'] },
    invoke: (api, params, pluginId) => api.plugin.deleteData(pluginId, params.key),
  },
  {
    method: 'lan:enable',
    permission: 'lan',
    bridge: { namespace: 'lan', name: 'enable', params: [] },
    invoke: (api) => api.lan.enable(),
  },
  {
    method: 'lan:disable',
    permission: 'lan',
    bridge: { namespace: 'lan', name: 'disable', params: [] },
    invoke: (api) => api.lan.disable(),
  },
  {
    method: 'lan:getDevices',
    permission: 'lan',
    bridge: { namespace: 'lan', name: 'getDevices', params: [] },
    invoke: (api) => api.lan.getDevices(),
  },
  {
    method: 'lan:getConfig',
    permission: 'lan',
    bridge: { namespace: 'lan', name: 'getConfig', params: [] },
    invoke: (api) => api.lan.getConfig(),
  },
  {
    method: 'lan:setConfig',
    permission: 'lan',
    bridge: { namespace: 'lan', name: 'setConfig', params: ['patch'] },
    invoke: (api, params) => api.lan.setConfig(params.patch),
  },
  {
    method: 'lan:pickPaths',
    permission: 'lan',
    bridge: { namespace: 'lan', name: 'pickPaths', params: ['mode'] },
    invoke: (api, params) => api.lan.pickPaths(params.mode),
  },
  {
    method: 'lan:send',
    permission: 'lan',
    bridge: { namespace: 'lan', name: 'send', params: ['deviceId', 'paths'] },
    invoke: (api, params) => api.lan.send(params.deviceId, params.paths),
  },
  {
    method: 'lan:cancel',
    permission: 'lan',
    bridge: { namespace: 'lan', name: 'cancel', params: ['transferId'] },
    invoke: (api, params) => api.lan.cancel(params.transferId),
  },
  {
    method: 'aiweb:getSites',
    permission: 'network',
    bridge: { namespace: 'aiWeb', name: 'getSites', params: [] },
    invoke: (api) => api.aiWeb.getSites(),
  },
  {
    method: 'aiweb:setSites',
    permission: 'network',
    bridge: { namespace: 'aiWeb', name: 'setSites', params: ['sites'] },
    invoke: (api, params) => api.aiWeb.setSites(params.sites),
  },
  {
    method: 'aiweb:open',
    permission: 'network',
    bridge: { namespace: 'aiWeb', name: 'open', params: ['siteId'] },
    invoke: (api, params) => api.aiWeb.open(params.siteId),
  },
  {
    method: 'aiweb:toggle',
    permission: 'network',
    bridge: { namespace: 'aiWeb', name: 'toggle', params: ['siteId'] },
    invoke: (api, params) => api.aiWeb.toggle(params.siteId),
  },
  {
    method: 'aiweb:getState',
    permission: 'network',
    bridge: { namespace: 'aiWeb', name: 'getState', params: [] },
    invoke: (api) => api.aiWeb.getState(),
  },
  {
    method: 'aiweb:setDefault',
    permission: 'network',
    bridge: { namespace: 'aiWeb', name: 'setDefault', params: ['siteId'] },
    invoke: (api, params) => api.aiWeb.setDefault(params.siteId ?? null),
  },
  {
    method: 'voice:getConfig',
    permission: 'network',
    bridge: { namespace: 'voice', name: 'getConfig', params: [] },
    invoke: (api) => api.voice.getConfig(),
  },
  {
    method: 'voice:setConfig',
    permission: 'network',
    bridge: { namespace: 'voice', name: 'setConfig', params: ['patch'] },
    invoke: (api, params) => api.voice.setConfig(params.patch),
  },
  {
    method: 'voice:startSession',
    permission: 'network',
    bridge: { namespace: 'voice', name: 'startSession', params: [] },
    invoke: (api) => api.voice.startSession(),
  },
  {
    method: 'voice:stopSession',
    permission: 'network',
    bridge: { namespace: 'voice', name: 'stopSession', params: [] },
    invoke: (api) => api.voice.stopSession(),
  },
  {
    method: 'voice:getStatus',
    permission: 'network',
    bridge: { namespace: 'voice', name: 'getStatus', params: [] },
    invoke: (api) => api.voice.getStatus(),
  },
  {
    method: 'voice:getSession',
    permission: 'network',
    bridge: { namespace: 'voice', name: 'getSession', params: [] },
    invoke: (api) => api.voice.getSession(),
  },
  {
    method: 'invoice:preview',
    permission: 'file-read',
    bridge: { namespace: 'invoice', name: 'preview', params: ['folder', 'config'] },
    invoke: (api, params) => api.invoice.preview(params.folder, params.config),
  },
  {
    method: 'invoice:generate',
    permission: 'file-write',
    bridge: { namespace: 'invoice', name: 'generate', params: ['folder', 'config'] },
    invoke: (api, params) => api.invoice.generate(params.folder, params.config),
  },
  {
    method: 'invoice:rename',
    permission: 'file-write',
    bridge: { namespace: 'invoice', name: 'rename', params: ['folder', 'config'] },
    invoke: (api, params) => api.invoice.rename(params.folder, params.config),
  },
  {
    method: 'invoice:indexScan',
    permission: 'file-read',
    bridge: { namespace: 'invoice', name: 'indexScan', params: ['parentFolder', 'options'] },
    invoke: (api, params) => api.invoice.indexScan(params.parentFolder, params.options),
  },
  {
    method: 'invoice:indexStatus',
    bridge: { namespace: 'invoice', name: 'indexStatus', params: [] },
    invoke: (api) => api.invoice.indexStatus(),
  },
  {
    method: 'invoice:indexClear',
    permission: 'file-write',
    bridge: { namespace: 'invoice', name: 'indexClear', params: [] },
    invoke: (api) => api.invoice.indexClear(),
  },
  {
    method: 'pomodoro:getState',
    bridge: { namespace: 'pomodoro', name: 'getState', params: [] },
    invoke: (api) => api.pomodoro.getState(),
  },
  {
    method: 'pomodoro:setSettings',
    bridge: { namespace: 'pomodoro', name: 'setSettings', params: ['patch'] },
    invoke: (api, params) => api.pomodoro.setSettings(params.patch ?? {}),
  },
  {
    method: 'pomodoro:timerAction',
    bridge: { namespace: 'pomodoro', name: 'timerAction', params: ['action'] },
    invoke: (api, params) => api.pomodoro.timerAction(params.action),
  },
  {
    method: 'pomodoro:logWater',
    bridge: { namespace: 'pomodoro', name: 'logWater', params: ['amountMl'] },
    invoke: (api, params) => api.pomodoro.logWater(params.amountMl),
  },
  {
    method: 'pomodoro:logStand',
    bridge: { namespace: 'pomodoro', name: 'logStand', params: [] },
    invoke: (api) => api.pomodoro.logStand(),
  },
  {
    method: 'pomodoro:saveCustomReminder',
    bridge: { namespace: 'pomodoro', name: 'saveCustomReminder', params: ['reminder'] },
    invoke: (api, params) => api.pomodoro.saveCustomReminder(params.reminder ?? {}),
  },
  {
    method: 'pomodoro:deleteCustomReminder',
    bridge: { namespace: 'pomodoro', name: 'deleteCustomReminder', params: ['id'] },
    invoke: (api, params) => api.pomodoro.deleteCustomReminder(params.id),
  },
  {
    method: 'pomodoro:getReport',
    bridge: { namespace: 'pomodoro', name: 'getReport', params: [] },
    invoke: (api) => api.pomodoro.getReport(),
  },
  {
    method: 'pomodoro:testFire',
    bridge: { namespace: 'pomodoro', name: 'testFire', params: ['kind'] },
    invoke: (api, params) => api.pomodoro.testFire(params.kind),
  },
  {
    method: 'pomodoro:testNotification',
    bridge: { namespace: 'pomodoro', name: 'testNotification', params: [] },
    invoke: (api) => api.pomodoro.testNotification(),
  },
  {
    method: 'pomodoro:openNotificationSettings',
    bridge: { namespace: 'pomodoro', name: 'openNotificationSettings', params: [] },
    invoke: (api) => api.pomodoro.openNotificationSettings(),
  },
  {
    method: 'net:ping',
    permission: 'network',
    bridge: { namespace: 'net', name: 'ping', params: ['host', 'count', 'timeoutMs'] },
    invoke: (api, params) => api.net.ping(params.host, params.count, params.timeoutMs),
  },
  {
    method: 'net:tcpCheck',
    permission: 'network',
    bridge: { namespace: 'net', name: 'tcpCheck', params: ['host', 'port', 'timeoutMs'] },
    invoke: (api, params) => api.net.tcpCheck(params.host, params.port, params.timeoutMs),
  },
  {
    method: 'net:dns',
    permission: 'network',
    bridge: { namespace: 'net', name: 'dns', params: ['host', 'type'] },
    invoke: (api, params) => api.net.dns(params.host, params.type),
  },
  {
    method: 'net:httpCheck',
    permission: 'network',
    bridge: { namespace: 'net', name: 'httpCheck', params: ['url', 'method'] },
    invoke: (api, params) => api.net.httpCheck(params.url, params.method),
  },
  {
    method: 'net:speedTest',
    permission: 'network',
    bridge: { namespace: 'net', name: 'speedTest', params: [] },
    invoke: (api) => api.net.speedTest(),
  },
  {
    method: 'net:cancelSpeedTest',
    permission: 'network',
    bridge: { namespace: 'net', name: 'cancelSpeedTest', params: [] },
    invoke: (api) => api.net.cancelSpeedTest(),
  },
  {
    method: 'net:info',
    permission: 'network',
    bridge: { namespace: 'net', name: 'info', params: ['force'] },
    invoke: (api, params) => api.net.info(params.force === true),
  },
  {
    method: 'search:status',
    permission: 'file-read',
    bridge: { namespace: 'search', name: 'status', params: [] },
    invoke: (api) => api.search.status(),
  },
  {
    method: 'search:query',
    permission: 'file-read',
    bridge: { namespace: 'search', name: 'query', params: ['params'] },
    invoke: (api, params) => api.search.query(params.params ?? {}),
  },
  {
    method: 'search:preview',
    permission: 'file-read',
    bridge: { namespace: 'search', name: 'preview', params: ['path'] },
    invoke: (api, params) => api.search.preview(params.path),
  },
  {
    method: 'search:reveal',
    permission: 'file-read',
    bridge: { namespace: 'search', name: 'reveal', params: ['path'] },
    invoke: (api, params) => api.search.reveal(params.path),
  },
  {
    method: 'compare:readText',
    permission: 'file-read',
    bridge: { namespace: 'compare', name: 'readText', params: ['path'] },
    invoke: (api, params) => api.compare.readText(params.path),
  },
  {
    method: 'compare:readImage',
    permission: 'file-read',
    bridge: { namespace: 'compare', name: 'readImage', params: ['path'] },
    invoke: (api, params) => api.compare.readImage(params.path),
  },
  {
    method: 'compare:inspect',
    permission: 'file-read',
    bridge: { namespace: 'compare', name: 'inspect', params: ['leftPath', 'rightPath'] },
    invoke: (api, params) => api.compare.inspect(params.leftPath, params.rightPath),
  },
  {
    method: 'compare:dirs',
    permission: 'file-read',
    bridge: { namespace: 'compare', name: 'compareDirs', params: ['leftPath', 'rightPath', 'options'] },
    invoke: (api, params) => api.compare.compareDirs(params.leftPath, params.rightPath, params.options),
  },
  {
    method: 'automation:list',
    bridge: { namespace: 'automation', name: 'list', params: [] },
    invoke: (api) => api.automation.list(),
  },
  {
    method: 'automation:save',
    bridge: { namespace: 'automation', name: 'save', params: ['command'] },
    invoke: (api, params) => api.automation.save(params.command),
  },
  {
    method: 'automation:delete',
    bridge: { namespace: 'automation', name: 'remove', params: ['id'] },
    invoke: (api, params) => api.automation.remove(params.id),
  },
  {
    method: 'automation:setEnabled',
    bridge: { namespace: 'automation', name: 'setEnabled', params: ['id', 'enabled'] },
    invoke: (api, params) => api.automation.setEnabled(params.id, params.enabled),
  },
  {
    method: 'automation:getSettings',
    bridge: { namespace: 'automation', name: 'getSettings', params: [] },
    invoke: (api) => api.automation.getSettings(),
  },
  {
    method: 'automation:setSettings',
    bridge: { namespace: 'automation', name: 'setSettings', params: ['patch'] },
    invoke: (api, params) => api.automation.setSettings(params.patch ?? {}),
  },
  {
    method: 'automation:run',
    bridge: { namespace: 'automation', name: 'run', params: ['commandId', 'args'] },
    invoke: (api, params) => api.automation.run(params.commandId, params.args),
  },
  {
    method: 'automation:history',
    bridge: { namespace: 'automation', name: 'getHistory', params: [] },
    invoke: (api) => api.automation.getHistory(),
  },
  {
    method: 'automation:clearHistory',
    bridge: { namespace: 'automation', name: 'clearHistory', params: [] },
    invoke: (api) => api.automation.clearHistory(),
  },
];

export const PLUGIN_METHODS_BY_NAME = new Map(
  PLUGIN_METHODS.map((method) => [method.method, method]),
);
