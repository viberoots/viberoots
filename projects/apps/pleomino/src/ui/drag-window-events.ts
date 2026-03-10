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
  let interactionLocked = false;
  let originalBodyOverflow = "";
  let originalBodyUserSelect = "";
  let originalBodyWebkitUserSelect = "";
  let originalBodyTouchAction = "";

  function lockInteraction() {
    if (interactionLocked || typeof document === "undefined") {
      return;
    }
    interactionLocked = true;
    originalBodyOverflow = document.body.style.overflow;
    originalBodyUserSelect = document.body.style.userSelect;
    originalBodyWebkitUserSelect = document.body.style.webkitUserSelect;
    originalBodyTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
    document.body.style.touchAction = "none";
  }

  function unlockInteraction() {
    if (!interactionLocked || typeof document === "undefined") {
      return;
    }
    interactionLocked = false;
    document.body.style.overflow = originalBodyOverflow;
    document.body.style.userSelect = originalBodyUserSelect;
    document.body.style.webkitUserSelect = originalBodyWebkitUserSelect;
    document.body.style.touchAction = originalBodyTouchAction;
  }

  function pointerFromMouseEvent(event: MouseEvent): PointerPoint {
    return {
      pageX: event.clientX + window.scrollX,
      pageY: event.clientY + window.scrollY,
    };
  }

  function handleMouseMove(event: MouseEvent) {
    if (!handlers.isDragging()) {
      return;
    }
    lockInteraction();
    event.preventDefault();
    handlers.onMove(pointerFromMouseEvent(event));
  }

  function handleTouchMove(event: TouchEvent) {
    if (!handlers.isDragging()) {
      return;
    }
    lockInteraction();
    event.preventDefault();
    const touch = event.touches[0] ?? event.changedTouches[0];
    if (!touch) {
      return;
    }
    handlers.onMove({ pageX: touch.pageX, pageY: touch.pageY });
  }

  function handleMouseUp(event: MouseEvent) {
    unlockInteraction();
    handlers.onEnd(pointerFromMouseEvent(event));
  }

  function handleTouchEnd(event: TouchEvent) {
    unlockInteraction();
    const touch = event.changedTouches[0];
    if (!touch) {
      handlers.onEnd(null);
      return;
    }
    handlers.onEnd({ pageX: touch.pageX, pageY: touch.pageY });
  }

  window.addEventListener("mousemove", handleMouseMove, true);
  window.addEventListener("mouseup", handleMouseUp, true);
  window.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("mouseup", handleMouseUp, true);
  document.addEventListener("mouseup", handleMouseUp);
  window.addEventListener("touchmove", handleTouchMove, { passive: false });
  window.addEventListener("touchend", handleTouchEnd);
  window.addEventListener("touchcancel", handleTouchEnd);

  return () => {
    unlockInteraction();
    window.removeEventListener("mousemove", handleMouseMove, true);
    window.removeEventListener("mouseup", handleMouseUp, true);
    window.removeEventListener("mouseup", handleMouseUp);
    document.removeEventListener("mouseup", handleMouseUp, true);
    document.removeEventListener("mouseup", handleMouseUp);
    window.removeEventListener("touchmove", handleTouchMove);
    window.removeEventListener("touchend", handleTouchEnd);
    window.removeEventListener("touchcancel", handleTouchEnd);
  };
}
