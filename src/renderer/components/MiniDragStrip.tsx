import { onCleanup, onMount } from 'solid-js';

interface MiniDragStripProps {
  class?: string;
}

// Drag strip for frameless windows. Press and drag anywhere on it to move the
// window. Movement is driven by the main process following the cursor, so it
// works for plugin iframes too and doesn't rely on -webkit-app-region.
export default function MiniDragStrip(props: MiniDragStripProps) {
  let ref!: HTMLDivElement;
  let dragging = false;

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener('pointerup', endDrag, true);
    document.removeEventListener('pointercancel', endDrag, true);
    window.aeroAPI?.window.endDrag();
  };

  const startDrag = (e: PointerEvent) => {
    if (e.button !== 0 || dragging) return;
    e.preventDefault();
    dragging = true;
    try {
      ref.setPointerCapture(e.pointerId);
    } catch {
      // pointer may already be gone
    }
    document.addEventListener('pointerup', endDrag, true);
    document.addEventListener('pointercancel', endDrag, true);
    window.aeroAPI?.window.startDrag();
  };

  onMount(() => {
    const onBlur = () => endDrag();
    window.addEventListener('blur', onBlur);
    onCleanup(() => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerup', endDrag, true);
      document.removeEventListener('pointercancel', endDrag, true);
    });
  });

  return (
    <div
      ref={ref}
      class={props.class ?? 'mini-drag-strip'}
      onPointerDown={startDrag}
    />
  );
}
