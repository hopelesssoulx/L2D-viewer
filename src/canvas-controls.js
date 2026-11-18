export function setupCanvasControls(canvas, { pick, select, move, zoom }) {
  let enabled = false;
  let drag;

  function finishDrag() {
    if (!drag) return;
    const { id } = drag;
    drag = undefined;
    delete canvas.dataset.dragging;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    const model = enabled && event.pointerType === "mouse" ? pick(event.clientX, event.clientY) : null;
    drag = { id: event.pointerId, model, x: event.clientX, y: event.clientY };
    if (model) canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    if (!(event.buttons & 1)) {
      finishDrag();
      return;
    }
    const x = event.clientX - drag.x;
    const y = event.clientY - drag.y;
    if (!drag.moving && Math.hypot(x, y) < 4) return;

    drag.moving = true;
    if (!drag.model) return;
    canvas.dataset.dragging = "";
    drag.x = event.clientX;
    drag.y = event.clientY;
    move(drag.model, x, y);
  });
  function endPointer(event) {
    if (drag?.id !== event.pointerId) return;
    const tapped = event.type === "pointerup" && event.target === canvas && !drag.moving
      && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4;
    finishDrag();
    if (tapped) {
      const model = pick(event.clientX, event.clientY);
      if (model) select(model);
    }
  }
  window.addEventListener("pointerup", endPointer);
  window.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("lostpointercapture", endPointer);
  window.addEventListener("blur", finishDrag);

  canvas.addEventListener("wheel", (event) => {
    if (!enabled || drag || event.ctrlKey) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    const delta = event.deltaY * unit;
    if (!delta) return;

    const model = pick(event.clientX, event.clientY);
    if (!model) return;
    event.preventDefault();
    zoom(model, Math.exp(-Math.max(-350, Math.min(350, delta)) * 0.0016));
  }, { passive: false });

  return (active) => {
    enabled = active;
    canvas.toggleAttribute("data-mouse-controls", enabled);
    if (!enabled) finishDrag();
  };
}
