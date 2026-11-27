# Aero — Domain Glossary

Aero is a local-first, offline productivity toolbox. Users invoke a floating search bar to quickly find and launch plugins. Plugins run in sandboxed iframes and communicate through a postMessage Bridge API.

---

## Application

**Aero** is the application itself — the Electron shell that hosts the Search Bar, manages plugin windows, and provides system services (hotkey, tray, storage, clipboard).

## Search Bar（搜索框）

A floating, always-on-top, glass-morphism panel invoked via global hotkey. It searches installed plugins and built-in tools, and launches them on selection. The Search Bar is the primary entry point to all functionality. It auto-hides on blur when no other Aero windows exist.

Code: window type `search`, component `SearchBar.tsx`.

## Built-in Tool（内置工具）

A tool shipped by Aero that runs in the core Electron app, not in a plugin iframe. Settings and Screen Recorder are built-in tools; they keep their `local.*` IDs for compatibility and are listed by the Search Bar alongside plugins.

Code: `builtinTools.ts`, `App.tsx`, `WindowManager.ts`.

## Plugin（插件）

A self-contained directory under `~/.aero/plugins/`. Each plugin is identified by a unique `pluginId` (e.g., `local.folder-bookmarks`) declared in `plugin.json`. A plugin contains:

- **plugin.json** — manifest: id, name, permissions, optional window size
- **view.html** — the entire plugin UI and logic in a single HTML file

Plugins run inside sandboxed iframes (`sandbox="allow-scripts allow-modals allow-downloads"`) and have no direct access to Node.js, Electron, or the filesystem. They communicate exclusively through the Bridge API.

## Plugin Window（插件窗口）

A frameless, transparent Electron `BrowserWindow` created when a plugin or built-in tool is launched. Mini windows are single-instance — launching the same tool again focuses the existing window. They are always-on-top at a level above the Search Bar. Each plugin's window position and size are remembered in `pluginWindowBounds`; first-time windows are cascaded so they don't stack on top of each other.

Code: window type `mini`, method `createMiniToolWindow()`.

## Bridge API

The postMessage-based RPC layer between a plugin iframe and the Aero main process. Each call is a `{id, method, params}` message posted to `window.parent`. `PLUGIN_METHODS` is the single source of truth for request/response methods; `PLUGIN_EVENTS` is the equivalent table for push events. Both declare the required permission and generated `window.aero` surface. The bridge script is generated from these tables in the main process; `EventRouter` delivers events only to windows whose plugin declared the permission.

Code: `pluginMethods.ts`, `pluginEvents.ts` (shared tables), `pluginBridge.ts` (renderer dispatch), `EventRouter.ts` (main fan-out), `index.ts` (bridge generation).

## App Config（应用配置）

The application-level configuration stored at `~/.aero/config/app-config.json`. Contains:

- **Hotkeys** — global keyboard shortcuts (toggle search bar)
- **Appearance** — dark/light mode plus custom accent / surface / elevated / glass colors
- **Privacy** — clipboard history settings
- **Plugins** — disabled list, favorites

Per-plugin permissions live separately in `permissions.json`.

Code: `ConfigService.ts`, schema in `src/shared/schemas/config.ts`.

## Theme（主题）

Dark and light modes share one theme model: a mode plus optional accent / surface / elevated / glass colors. The renderer applies the mode as `data-theme` on `<html>`; the BrowserWindow preload applies it before first paint. Plugin iframes are themed by the generated bridge, which sets `data-aero-theme`, exposes semantic `--aero-*` colors, and loads an optional `light.css` from the plugin directory only in light mode. Plugins must keep photos, QR codes, whiteboard canvases and Excel preview tables in their original colors.

Code: `src/shared/theme.ts`, `src/renderer/theme.ts`, `getBridgeScript()` in `src/main/index.ts`, `plugins/*/light.css`.

## Plugin Storage（插件存储）

Per-plugin persistent storage backed by SQLite. Each plugin gets its own database file at `~/.aero/plugin-data/{pluginId}.db` with a simple key-value table (`kv_store`). Plugins access it through the Bridge API (`storage:get`, `storage:set`, `storage:delete`).

Code: `DataService.ts`.

## Phone Remote（手机遥控）

The phone acts as a remote keyboard and keypad, not a microphone. The PC runs a plain HTTP server and shows a one-token session URL/QR. The phone page has two modes:

- **Voice**: the user dictates into a textarea with the phone's IME (e.g. Doubao voice input). The composer has thumb-sized **Backspace / Newline / Clear / Enter-send** actions: Backspace, Newline and Clear edit the local draft when it has text, otherwise they send those keys to the PC (Newline sends Shift+Enter); Enter sends the draft (paste) and presses Enter. Optional auto-paste can push the draft to the PC without pressing Enter.
- **Keys**: a grid of common keys (Enter, Backspace, arrows, media, etc.) and user-defined macros. The PC parses each combo/sequence (`ctrl+s`, `ctrl+a, ctrl+c, sleep:150, alt+tab, ctrl+v`) and injects it via `keybd_event`.

A persistent `AeroKeys.exe` helper (started with the session) performs the injections, so per-action latency is tens of milliseconds instead of paying PowerShell startup every time. A PowerShell fallback is used if the helper is unavailable. Macros are edited in the plugin UI and stored in app config; the phone page refreshes them every few seconds. No microphone access, HTTPS, CA certificate, STT endpoint, API key, or PC-side status HUD is involved.

Code: `VoiceService.ts`, `InputInjector.ts`, `keyboard.ts`, `src/renderer/phone.html`, `plugins/local.voice-typing/` (`bin/AeroKeys.exe`, source in `helper/`).

## AI Web Quick-Open（AI 网页快开）

A long-lived `BrowserWindow` that loads an AI web app in a persistent session partition (`persist:aero-aiweb`), so login state survives restarts. The window remembers its bounds. The global `toggleAiWeb` hotkey (default F4) opens or hides it; the `local.ai-web` plugin manages the site list. The window has no preload/Node access and denies camera/mic/notification permissions.

Code: `AiWebService.ts`, `plugins/local.ai-web/`, `network` permission.

## LAN Transfer（局域网传输）

A local-network transfer feature exposed to the `local.lan-transfer` plugin. Each device broadcasts a UDP beacon; peers are listed by name/IP. Sending streams a manifest and file contents over TCP, never buffering whole files. The receiver validates every relative path, confirms explicitly unless the device is trusted, writes `.part` files, verifies SHA-256, and renames on success.

Code: `LanTransferService.ts`, `plugins/local.lan-transfer/`, `lan` permission.

## everyCompare（内容对比插件）

A local-only comparison workbench exposed through the `local.every-compare` plugin. Text comparison offers a VSCode-style editor (line numbers, Ln/Col, wrap-aware gutter, smart line pairing, word-level highlights, split/unified views, collapsible unchanged regions, hunk navigation, and applying individual hunks to either side). Image comparison provides side-by-side, slider, pixel-diff, blink and overlay modes with zoom/pan. File comparison computes SHA-256 fingerprints and metadata, then deep-links text and image files into their respective comparators. Folder comparison recursively scans two trees, aligns them in a single expandable tree, aggregates directory status, compares same-size files by SHA-256 (or size + mtime in quick mode), and opens a selected file directly in the text/image/file comparator. Folder paths can be typed, pasted (including quoted paths and `file://` URLs) or chosen with the native folder picker. The last folder pair, scan mode and ignore settings are restored automatically on reopen, and recent pairs are kept for one-click recall. A persisted parameter board compares arbitrary items and parameters, with TSV/Markdown import and smart format matching. Everything runs locally; no network requests.

Code: `CompareService.ts` (`compareDirs` scans/hashes both trees), `src/shared/types/everyCompare.ts`, `plugins/local.every-compare/`, permissions `file-read` + `clipboard`.

## Automation Assistant（自动化助手）

A command-palette feature exposed through the `local.automation` plugin. It ships system commands (public IP, ping, DNS, HTTP check, text transforms, UUID, SHA-256) plus user-authored CMD/PowerShell scripts. Every command has an enable switch; enabled commands are matched by the Search Bar as `<token> <args>` and executed with Enter. Runs execute in the main process, are mirrored into a floating result window with live status, auto-copy their output when enabled, and keep a persisted history. Custom scripts support `{args}`, `{1}` / `{2}` and `{clipboard}` placeholders and only run when the user explicitly types the command.

Code: `AutomationService.ts`, `plugins/local.automation/`, result window `AutomationResult.tsx`.

## Invoice Organizer（发票处理）

A local-only reimbursement organizer exposed to the `local.invoice-organizer` plugin. It extracts text from PDF invoices and itinerary sheets, classifies them (Didi/train/flight/hotel/other), pairs invoices with itineraries by amount, numbers them by earliest travel date, and writes a styled Excel workbook with a summary sheet and an invoice reconciliation sheet. Optional rename creates a full backup first. Image-only/scanned receipts are not OCR'd. Invoice numbers are recorded in a persistent local index, so every preview/generate also flags duplicates within the folder and across previously seen folders. A separate full-directory scan recursively indexes a parent folder (all month subfolders) and reports duplicates in one pass; it never modifies or deletes invoice files.

Code: `InvoiceService.ts`, `plugins/local.invoice-organizer/`, index in `~/.aero/plugin-data/local.invoice-organizer.db`.

## Plugin Permissions（插件权限）

Capabilities a plugin declares in `plugin.json` under `"permissions"`. Examples: `clipboard`, `file-read`, `file-write`. The Bridge API checks that the plugin declared the required permission for each method; explicit `denied` entries in `permissions.json` block the call.

Code: `pluginMethods.ts`, `pluginBridge.ts`, `permissions.json`.

## Hotkey（快捷键）

A global keyboard shortcut registered with the OS. The primary hotkey toggles the Search Bar. Hotkeys are configurable in settings and persisted in App Config.

Code: `HotkeyService.ts`.

## System Tray（系统托盘）

A tray icon providing quick access to toggle the Search Bar, open settings, or quit the application.

