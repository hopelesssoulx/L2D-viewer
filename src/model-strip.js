export class ModelStrip {
  #host;
  #buttons = new Map();
  #models = new WeakMap();
  #drag;
  #skipClick = false;
  #onMove;

  constructor(host, onSelect, onMove) {
    this.#host = host;
    this.#onMove = onMove;
    host.addEventListener("click", (event) => {
      if (event.detail > 0 && this.#skipClick) return;
      const model = this.#models.get(event.target.closest("button"));
      if (model) onSelect(model);
    });
    host.addEventListener("keydown", (event) => {
      if (!event.shiftKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      const button = event.target.closest(".model-chip");
      if (!button) return;
      event.preventDefault();
      const index = [...host.children].indexOf(button);
      const next = index + (event.key === "ArrowLeft" ? -1 : 1);
      if (next < 0 || next >= host.childElementCount) return;
      this.#move(button, next);
    });
    host.addEventListener("pointerdown", (event) => {
      this.#skipClick = false;
      const button = event.target.closest(".model-chip");
      if (!button || this.#drag || event.button !== 0) return;
      if (event.pointerType !== "mouse" && !event.target.closest(".model-grip")) return;
      this.#drag = { button, id: event.pointerId, start: event.clientX };
      button.setPointerCapture(event.pointerId);
    });
    host.addEventListener("pointermove", (event) => {
      const drag = this.#drag;
      if (drag?.id !== event.pointerId) return;
      if (!drag.active && Math.abs(event.clientX - drag.start) < 5) return;
      drag.active = true;
      drag.x = event.clientX;
      drag.button.dataset.dragging = "";
      cancelAnimationFrame(drag.frame);
      this.#updateDrop(drag);
    });
    host.addEventListener("pointerup", (event) => this.#finishDrag(event, true));
    host.addEventListener("pointercancel", (event) => this.#finishDrag(event, false));
    host.addEventListener("lostpointercapture", (event) => this.#finishDrag(event, false));
  }

  render(models, selected) {
    for (const [model, button] of this.#buttons) {
      if (!models.includes(model)) {
        button.remove();
        this.#buttons.delete(model);
      }
    }

    models.forEach((model, index) => {
      let button = this.#buttons.get(model);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "model-chip";
        button.title = model.source.path;
        button.setAttribute("aria-keyshortcuts", "Shift+ArrowLeft Shift+ArrowRight");
        const grip = document.createElement("span");
        grip.className = "model-grip";
        grip.title = "拖动调整图层";
        grip.setAttribute("aria-hidden", "true");
        const name = document.createElement("span");
        name.className = "model-chip-name";
        name.textContent = model.name;
        button.append(grip, name);
        this.#buttons.set(model, button);
        this.#models.set(button, model);
      }
      button.setAttribute("aria-pressed", model === selected);
      if (this.#host.children[index] !== button) {
        this.#host.insertBefore(button, this.#host.children[index] ?? null);
      }
    });
  }

  focus(model) {
    this.#buttons.get(model)?.focus({ preventScroll: true });
  }

  reveal(model) {
    const button = this.#buttons.get(model);
    if (!button) return;
    const strip = this.#host.getBoundingClientRect();
    const item = button.getBoundingClientRect();
    if (item.left < strip.left) this.#host.scrollLeft += item.left - strip.left - 3;
    else if (item.right > strip.right) this.#host.scrollLeft += item.right - strip.right + 3;
  }

  #move(button, index) {
    const model = this.#models.get(button);
    this.#onMove(model, index);
    this.focus(model);
    this.reveal(model);
  }

  #updateDrop(drag) {
    const host = this.#host;
    const rect = host.getBoundingClientRect();
    const scroll = drag.x < rect.left + 20 ? -8 : drag.x > rect.right - 20 ? 8 : 0;
    const before = host.scrollLeft;
    host.scrollLeft += scroll;

    const others = [...host.children].filter((button) => button !== drag.button);
    const next = others.findIndex((button) => {
      const rect = button.getBoundingClientRect();
      return drag.x < rect.left + rect.width / 2;
    });
    drag.target = next < 0 ? others.length : next;
    if (drag.marker) delete drag.marker.dataset.insert;
    drag.marker = next < 0 ? others.at(-1) : others[next];
    if (drag.marker) drag.marker.dataset.insert = next < 0 ? "after" : "before";
    if (host.scrollLeft !== before) drag.frame = requestAnimationFrame(() => this.#updateDrop(drag));
  }

  #finishDrag(event, commit) {
    const drag = this.#drag;
    if (drag?.id !== event.pointerId) return;
    this.#drag = undefined;
    cancelAnimationFrame(drag.frame);
    delete drag.button.dataset.dragging;
    if (drag.marker) delete drag.marker.dataset.insert;
    if (drag.active) {
      this.#skipClick = true;
      if (commit) this.#move(drag.button, drag.target);
    }
  }
}
