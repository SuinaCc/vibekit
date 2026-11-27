import { createSignal, Show, onCleanup } from 'solid-js';
import ContextMenu, { type MenuItem } from './ContextMenu';
import type { SearchItem } from '@shared';

interface ResultItemProps {
  item: SearchItem & { pluginId: string };
  isSelected: boolean;
  isFavorited: boolean;
  onClick: () => void;
  onHover: () => void;
  onContextMenu: (items: MenuItem[]) => void;
}

const categoryLabels: Record<string, string> = {
  code: '{}', text: 'Aa', image: '◻', system: '⚙', vibe: '~', tools: '⌘', dev: '#',
};

export default function ResultItem(props: ResultItemProps) {
  const [ctxMenu, setCtxMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [tooltip, setTooltip] = createSignal<{ x: number; y: number } | null>(null);
  let ref!: HTMLDivElement;
  let tipTimer: ReturnType<typeof setTimeout>;

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (props.item.automation) return;
    const items: MenuItem[] = [];
    props.onContextMenu(items);
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  };

  let tipRef!: HTMLDivElement;
  const showTooltip = () => {
    tipTimer = setTimeout(() => {
      const r = ref.getBoundingClientRect();
      setTooltip({ x: r.left + r.width / 2, y: r.top - 8 });
      // Adjust position after render to stay within viewport
      requestAnimationFrame(() => {
        if (!tipRef) return;
        const tr = tipRef.getBoundingClientRect();
        let lx = r.left + r.width / 2;
        let ly = r.top - 8;
        if (lx - tr.width / 2 < 4) lx = tr.width / 2 + 4;
        if (lx + tr.width / 2 > window.innerWidth - 4) lx = window.innerWidth - tr.width / 2 - 4;
        if (ly - tr.height < 4) ly = r.bottom + 8 + tr.height; // flip below
        setTooltip({ x: lx, y: ly });
      });
    }, 400);
  };

  const hideTooltip = () => {
    clearTimeout(tipTimer);
    setTooltip(null);
  };

  const cat = props.item.category || props.item.pluginId.split('.')[1]?.split('-')[0] || 'code';
  const desc = props.item.subtitle;
  const [iconBroken, setIconBroken] = createSignal(false);

  const iconSrc = () => {
    if (props.item.automation || !props.item.icon) return null;
    const icon = props.item.icon;
    if (/^(?:https?:|data:|app:|blob:|\/)/i.test(icon)) return icon;
    const relative = icon.replace(/^\.?\//, '');
    const encoded = relative.split('/').map((part) => encodeURIComponent(part)).join('/');
    return `app://${encodeURIComponent(props.item.pluginId)}/${encoded}`;
  };
  const showIcon = () => !!iconSrc() && !iconBroken();

  return (
    <>
      <div
        ref={ref}
        class="result-item"
        classList={{ 'result-item-selected': props.isSelected }}
        onClick={props.onClick}
        onMouseEnter={() => { props.onHover(); showTooltip(); }}
        onMouseLeave={hideTooltip}
        onContextMenu={handleContextMenu}
      >
        <div class="result-item-icon">
          <Show
            when={showIcon()}
            fallback={
              <span class="result-item-icon-fallback" style="display:flex">
                {categoryLabels[cat] || 'P'}
              </span>
            }
          >
            <img
              class="result-item-icon-img"
              src={iconSrc()!}
              alt=""
              draggable={false}
              onError={() => setIconBroken(true)}
            />
          </Show>
        </div>
        <span class="result-item-title">{props.item.title}</span>
        {props.isFavorited && <span class="result-item-star">★</span>}
      </div>

      {/* Tooltip */}
      <Show when={tooltip() && desc}>
        <div
          ref={tipRef}
          class="plugin-tooltip glass-panel"
          style={{
            position: 'fixed',
            left: `${tooltip()!.x}px`,
            top: `${tooltip()!.y}px`,
            transform: 'translate(-50%, -100%)',
            'z-index': '99999',
            'max-width': '240px',
            padding: '10px 14px',
            'border-radius': '12px',
            'font-size': '12px',
            'line-height': '1.5',
            color: 'var(--color-text-primary)',
            'pointer-events': 'none',
            animation: 'fade-in 0.15s ease-out',
          }}
        >
          <div style={{
            position: 'absolute', bottom: '-5px', left: '50%',
            transform: 'translateX(-50%) rotate(45deg)',
            width: '10px', height: '10px',
            background: 'var(--color-surface-glass)',
            border: '1px solid var(--color-border)',
            'border-top': 'none', 'border-left': 'none',
          }} />
          {desc}
        </div>
      </Show>

      {/* Context Menu */}
      <Show when={ctxMenu()}>
        <ContextMenu
          items={ctxMenu()!.items}
          x={ctxMenu()!.x}
          y={ctxMenu()!.y}
          onClose={() => setCtxMenu(null)}
        />
      </Show>
    </>
  );
}
