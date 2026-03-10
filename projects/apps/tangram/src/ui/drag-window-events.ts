export type PointerPoint = {
  pageX: number;
  pageY: number;
};

export type GlobalDragHandlers = {
  isDragging: () => boolean;
  onMove: (pointer: PointerPoint) => void;
  onEnd: (pointer?: PointerPoint | null) => void;
};

export function bindGlobalDragListeners(handlers: GlobalDragHandlers): () => void {
  function handleMouseMove(event: MouseEvent) {
    if (!handlers.isDragging()) {
      return;
    }
    handlers.onMove({ pageX: event.pageX, pageY: event.pageY });
  }

  function handleTouchMove(event: TouchEvent) {
    if (!handlers.isDragging()) {
      return;
    }
    const touch = event.touches[0] ?? event.changedTouches[0];
    if (!touch) {
      return;
    }
    handlers.onMove({ pageX: touch.pageX, pageY: touch.pageY });
  }

  function handleMouseUp(event: MouseEvent) {
    handlers.onEnd({ pageX: event.pageX, pageY: event.pageY });
  }

  function handleTouchEnd(event: TouchEvent) {
    const touch = event.changedTouches[0];
    if (!touch) {
      handlers.onEnd(null);
      return;
    }
    handlers.onEnd({ pageX: touch.pageX, pageY: touch.pageY });
  }

  window.addEventListener("mousemove", handleMouseMove);
  window.addEventListener("mouseup", handleMouseUp);
  window.addEventListener("touchmove", handleTouchMove, { passive: true });
  window.addEventListener("touchend", handleTouchEnd);
  window.addEventListener("touchcancel", handleTouchEnd);

  return () => {
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
    window.removeEventListener("touchmove", handleTouchMove);
    window.removeEventListener("touchend", handleTouchEnd);
    window.removeEventListener("touchcancel", handleTouchEnd);
  };
}
