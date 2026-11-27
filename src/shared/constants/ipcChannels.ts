// IPC Channel name constants
// Naming convention: domain:action (request-response), domain:event (push events)

export const IPC = {
  // Plugin channels
  PLUGIN_LIST: 'plugin:list',
  PLUGIN_ENABLE: 'plugin:enable',
  PLUGIN_DISABLE: 'plugin:disable',
  PLUGIN_UNINSTALL: 'plugin:uninstall',
  PLUGIN_DATA_READ: 'plugin:data:read',
  PLUGIN_DATA_WRITE: 'plugin:data:write',
  PLUGIN_DATA_DELETE: 'plugin:data:delete',
  PLUGIN_PERMISSIONS_GET: 'plugin:permissions:get',

  // Window channels
  WINDOW_SEARCH_SHOW: 'window:search:show',
  WINDOW_SEARCH_HIDE: 'window:search:hide',
  WINDOW_SEARCH_TOGGLE: 'window:search:toggle',
  WINDOW_MINI_CREATE: 'window:mini:create',
  WINDOW_MINI_CLOSE: 'window:mini:close',
  WINDOW_CLOSE_CURRENT: 'window:close:current',
  WINDOW_DRAG_START: 'window:drag:start',
  WINDOW_DRAG_END: 'window:drag:end',

  // System channels
  SYSTEM_CLIPBOARD_READ: 'system:clipboard:read',
  SYSTEM_CLIPBOARD_WRITE: 'system:clipboard:write',
  SYSTEM_CLIPBOARD_HISTORY: 'system:clipboard:history',
  SYSTEM_CLIPBOARD_CLEAR: 'system:clipboard:clear',
  SYSTEM_NOTIFY: 'system:notify',
  SYSTEM_FILE_SELECT: 'system:file:select',
  SYSTEM_FILE_READ: 'system:file:read',
  SYSTEM_FILE_WRITE: 'system:file:write',
  SYSTEM_HOTKEY_GET: 'system:hotkey:get',
  SYSTEM_HOTKEY_SET: 'system:hotkey:set',
  SYSTEM_OPEN_EXTERNAL: 'system:open:external',

  // LAN transfer
  LAN_ENABLE: 'lan:enable',
  LAN_DISABLE: 'lan:disable',
  LAN_GET_DEVICES: 'lan:get-devices',
  LAN_GET_CONFIG: 'lan:get-config',
  LAN_SET_CONFIG: 'lan:set-config',
  LAN_PICK_PATHS: 'lan:pick-paths',
  LAN_SEND: 'lan:send',
  LAN_CANCEL: 'lan:cancel',

  // AI web quick-open
  AIWEB_GET_SITES: 'aiweb:get-sites',
  AIWEB_SET_SITES: 'aiweb:set-sites',
  AIWEB_OPEN: 'aiweb:open',
  AIWEB_TOGGLE: 'aiweb:toggle',
  AIWEB_GET_STATE: 'aiweb:get-state',
  AIWEB_SET_DEFAULT: 'aiweb:set-default',

  // Pomodoro plugin channels
  POMODORO_GET_STATE: 'pomodoro:get-state',
  POMODORO_SET_SETTINGS: 'pomodoro:set-settings',
  POMODORO_TIMER_ACTION: 'pomodoro:timer-action',
  POMODORO_LOG_WATER: 'pomodoro:log-water',
  POMODORO_UNDO_WATER: 'pomodoro:undo-water',
  POMODORO_LOG_STAND: 'pomodoro:log-stand',
  POMODORO_CUSTOM_SAVE: 'pomodoro:custom-save',
  POMODORO_CUSTOM_DELETE: 'pomodoro:custom-delete',
  POMODORO_REPORT: 'pomodoro:report',
  POMODORO_TEST_FIRE: 'pomodoro:test-fire',
  POMODORO_TEST_NOTIFICATION: 'pomodoro:test-notification',
  POMODORO_OPEN_NOTIFICATION_SETTINGS: 'pomodoro:open-notification-settings',
  WINDOW_HUD_ACTION: 'window:hud-action',

  // Network tools channels
  NET_PING: 'net:ping',
  NET_TCP_CHECK: 'net:tcp-check',
  NET_DNS: 'net:dns',
  NET_HTTP_CHECK: 'net:http-check',
  NET_SPEED_TEST: 'net:speed-test',
  NET_SPEED_CANCEL: 'net:speed-cancel',
  NET_INFO: 'net:info',

  // Search Master channels
  SEARCHMASTER_STATUS: 'search-master:status',
  SEARCHMASTER_QUERY: 'search-master:query',
  SEARCHMASTER_PREVIEW: 'search-master:preview',
  SEARCHMASTER_REVEAL: 'search-master:reveal',

  // Automation assistant
  AUTOMATION_LIST: 'automation:list',
  AUTOMATION_SAVE: 'automation:save',
  AUTOMATION_DELETE: 'automation:delete',
  AUTOMATION_SET_ENABLED: 'automation:set-enabled',
  AUTOMATION_GET_SETTINGS: 'automation:get-settings',
  AUTOMATION_SET_SETTINGS: 'automation:set-settings',
  AUTOMATION_RUN: 'automation:run',
  AUTOMATION_START_SEARCH: 'automation:start-search',
  AUTOMATION_GET_RUN: 'automation:get-run',
  AUTOMATION_LIST_ENABLED: 'automation:list-enabled',
  AUTOMATION_HISTORY: 'automation:history',
  AUTOMATION_CLEAR_HISTORY: 'automation:clear-history',

  // everyCompare channels
  COMPARE_READ_TEXT: 'compare:read-text',
  COMPARE_READ_IMAGE: 'compare:read-image',
  COMPARE_INSPECT: 'compare:inspect',
  COMPARE_DIRS: 'compare:dirs',

  // Phone voice typing
  VOICE_GET_CONFIG: 'voice:get-config',
  VOICE_SET_CONFIG: 'voice:set-config',
  VOICE_START_SESSION: 'voice:start-session',
  VOICE_STOP_SESSION: 'voice:stop-session',
  VOICE_GET_STATUS: 'voice:get-status',
  VOICE_GET_SESSION: 'voice:get-session',

  // Invoice reimbursement organizer
  INVOICE_PREVIEW: 'invoice:preview',
  INVOICE_GENERATE: 'invoice:generate',
  INVOICE_RENAME: 'invoice:rename',
  INVOICE_INDEX_SCAN: 'invoice:index:scan',
  INVOICE_INDEX_STATUS: 'invoice:index:status',
  INVOICE_INDEX_CLEAR: 'invoice:index:clear',

  // Theme
  THEME_APPLY: 'theme:apply',

  // Settings channels
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_RESET: 'settings:reset',
  SETTINGS_EXPORT: 'settings:export',
  SETTINGS_IMPORT: 'settings:import',
  SETTINGS_CLEAR_DATA: 'settings:clear-data',

  // Recorder
  RECORDER_GET_SOURCES: 'recorder:get-sources',
  RECORDER_GET_DISPLAYS: 'recorder:get-displays',
  RECORDER_START: 'recorder:start',
  RECORDER_STOP: 'recorder:stop',
  RECORDER_PICK_REGION: 'recorder:pick-region',
  RECORDER_GET_STATE: 'recorder:get-state',
  RECORDER_SET_CONFIG: 'recorder:set-config',
  RECORDER_GET_CONFIG: 'recorder:get-config',
  RECORDER_OPEN_PATH: 'recorder:open-path',
  RECORDER_BEGIN_SAVE: 'recorder:begin-save',
  RECORDER_APPEND_CHUNK: 'recorder:append-chunk',
  RECORDER_FINISH_SAVE: 'recorder:finish-save',
} as const;
