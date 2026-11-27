import { onCleanup, onMount } from 'solid-js';
import { getCurrentAccent, onThemeChange } from '../../theme';
import { dispatchPluginMethod, loadPluginPermissionContext, type PluginPermissionContext } from '../../pluginBridge';
import MiniDragStrip from '../MiniDragStrip';

interface PluginFrameProps {
  pluginId: string;
}

// Handle postMessage from plugin iframe and route through the Bridge API table
function handlePluginMessage(e: MessageEvent, pluginId: string, permissionContext: PluginPermissionContext | null) {
  const d = e.data;
  if (!d || d.src !== 'aero-plugin') return;

  // Handle theme request — send the full theme back to iframe
  if (d.type === 'aero-request-theme' && d.pluginId === pluginId) {
    const { accent, glow, surface, glass, mode } = getCurrentAccent();
    (e.source as Window).postMessage({ type: 'aero-theme', accent, glow, surface, glass, mode }, '*');
    return;
  }

  if (d.pluginId !== pluginId) return;

  const api = window.aeroAPI;
  if (!api) return sendError(e.source as Window, d.id, 'API not available');

  (async () => {
    try {
      const result = await dispatchPluginMethod(api, pluginId, d.method, d.params ?? {}, permissionContext);
      (e.source as Window).postMessage({ id: d.id, result, src: 'aero-plugin' }, '*');
    } catch (err: unknown) {
      sendError(e.source as Window, d.id, err instanceof Error ? err.message : String(err));
    }
  })();
}

function sendError(target: Window, id: string, message: string) {
  target.postMessage({ id, error: message, src: 'aero-plugin' }, '*');
}

export default function PluginFrame(props: PluginFrameProps) {
  let iframeRef!: HTMLIFrameElement;
  let permissionContext: PluginPermissionContext | null = null;

  // Send theme vars to iframe
  const sendThemeToIframe = () => {
    const { accent, glow, surface, glass, mode } = getCurrentAccent();
    iframeRef.contentWindow?.postMessage({ type: 'aero-theme', accent, glow, surface, glass, mode }, '*');
  };

  onMount(() => {
    const handler = (e: MessageEvent) => {
      // Only accept messages from this plugin's iframe.
      if (!iframeRef.contentWindow || e.source !== iframeRef.contentWindow) return;
      handlePluginMessage(e, props.pluginId, permissionContext);
    };
    window.addEventListener('message', handler);

    // Resolve the plugin manifest + permission state once per window instead of
    // on every bridge RPC.
    if (window.aeroAPI) {
      void loadPluginPermissionContext(window.aeroAPI, props.pluginId).then((context) => {
        permissionContext = context;
      });
    }

    // Listen for theme changes and forward to iframe
    const unsubTheme = onThemeChange(() => {
      sendThemeToIframe();
    });

    // Forward routed push events to this plugin's iframe.
    const unsubEvents = window.aeroAPI?.onEvent('aero:bridge-event', (data: any) => {
      iframeRef.contentWindow?.postMessage({ type: 'aero-event', event: data?.event, payload: data?.payload }, '*');
    });

    onCleanup(() => {
      window.removeEventListener('message', handler);
      if (unsubTheme) unsubTheme();
      if (unsubEvents) unsubEvents();
    });
  });

  return (
    <div class="mini-window-root">
      <MiniDragStrip />
      <button
        class="plugin-close-btn no-drag"
        onClick={() => window.aeroAPI?.window.closeCurrent()}
        title="关闭 (Esc)"
        aria-label="关闭"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6 6 18" /><path d="m6 6 12 12" />
        </svg>
      </button>
      <div class="mini-window-body">
        <iframe
          ref={iframeRef}
          class="plugin-iframe"
          src={`app://${encodeURIComponent(props.pluginId)}/view.html`}
          sandbox="allow-scripts allow-modals allow-downloads"
        />
      </div>
    </div>
  );
}
