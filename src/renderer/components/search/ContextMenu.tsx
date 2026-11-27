import { createSignal, onCleanup, onMount } from 'solid-js';

export interface MenuItem {
  label: string;
  action: () => void;
}

interface ContextMenuProps {
  items: MenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}

export default function ContextMenu(props: ContextMenuProps) {
  let menuRef!: HTMLDivElement;

  onMount(() => {
    // Close on any click outside
    const close = (e: MouseEvent) => {
      if (menuRef && !menuRef.contains(e.target as Node)) {
        props.onClose();
      }
    };
    // Delay to avoid immediate close from the right-click event itself
    setTimeout(() => document.addEventListener('click', close), 0);
    // Close on Esc
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    });
  });

  return (
    <div
      ref={menuRef}
      class="ctx-menu glass-panel"
      style={{ position: 'fixed', left: `${props.x}px`, top: `${props.y}px`, 'z-index': 9999 }}
    >
      {props.items.map((item) => (
        <button class="ctx-menu-item" onClick={() => { item.action(); props.onClose(); }}>
          {item.label}
        </button>
      ))}
    </div>
  );
}
