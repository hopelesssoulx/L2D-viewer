import { setupCanvasControls } from "./canvas-controls.js";
import { visibleCubism2Drawables } from "./cubism2.js";
import { ViewerModel } from "./live2d-model.js";

function* visibleDrawables(model) {
  const { coreModel: core } = model.display.internalModel;
  if (model.cubism2) {
    yield* visibleCubism2Drawables(core);
    return;
  }
  for (let index = 0; index < core.getDrawableCount(); index++) {
    if (core.getDrawableDynamicFlagIsVisible(index) && core.getDrawableOpacity(index) > 0.01) {
      yield index;
    }
  }
}

function measureModel(model) {
  const internal = model.display.internalModel;
  const { localTransform } = internal;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const bounds = {};
  for (const index of visibleDrawables(model)) {
    internal.getDrawableBounds(index, bounds);
    if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) continue;
    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.width);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }
  if (!(right > left && bottom > top)) {
    return { x: 0, y: 0, width: internal.width, height: internal.height };
  }

  return {
    x: left * localTransform.a + localTransform.tx,
    y: top * localTransform.d + localTransform.ty,
    width: (right - left) * localTransform.a,
    height: (bottom - top) * localTransform.d,
  };
}

function hitsModel(model, point) {
  const { display, cubism2 } = model;
  const internal = display.internalModel;
  const core = internal.coreModel;
  const local = display.toModelPosition(point);
  const x = cubism2 ? local.x : (local.x - internal.originalWidth / 2) / internal.pixelsPerUnit;
  const y = cubism2 ? local.y : (internal.originalHeight / 2 - local.y) / internal.pixelsPerUnit;
  const context = cubism2 ? core.getModelContext() : null;

  for (const index of visibleDrawables(model)) {
    const vertices = cubism2 ? core.getTransformedPoints(index) : core.getDrawableVertices(index);
    const triangles = cubism2 ? context.getDrawData(index).getIndexArray() : core.getDrawableVertexIndices(index);
    for (let i = 0; i < triangles.length; i += 3) {
      const a = 2 * triangles[i];
      const b = 2 * triangles[i + 1];
      const c = 2 * triangles[i + 2];
      const ax = vertices[a], ay = vertices[a + 1];
      const bx = vertices[b], by = vertices[b + 1];
      const cx = vertices[c], cy = vertices[c + 1];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (area === 0) continue;
      const ab = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      const bc = (cx - bx) * (y - by) - (cy - by) * (x - bx);
      const ca = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
      if (area > 0 ? ab >= 0 && bc >= 0 && ca >= 0 : ab <= 0 && bc <= 0 && ca <= 0) {
        return true;
      }
    }
  }
  return false;
}

export class ModelScene {
  models = [];
  selected = null;
  #app;
  #highlight;
  #toolbar;
  #toolbarInset;
  #placements = new WeakMap();

  constructor(pixi, host, toolbar, onSelect, onTransform) {
    this.pixi = pixi;
    this.#toolbar = toolbar;
    this.#toolbarInset = toolbar.offsetHeight + 8;
    this.#app = new pixi.Application({
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      backgroundAlpha: 0,
      antialias: true,
    });
    this.#app.view.setAttribute("aria-hidden", "true");
    host.append(this.#app.view);
    this.#highlight = new pixi.Graphics();
    this.#app.stage.addChild(this.#highlight);
    this.setMouseControls = setupCanvasControls(this.#app.view, {
      pick: (x, y) => this.#pick(x, y),
      select: onSelect,
      move: (model, dx, dy) => {
        const placement = this.#placements.get(model);
        if (placement) onTransform(model, { x: placement.x + dx, y: placement.y + dy });
      },
      zoom: (model, factor) => {
        const { size } = this.#placements.get(model);
        onTransform(model, { size: Math.round(size * factor * 100) / 100 });
      },
    });
    this.#app.ticker.add(() => {
      for (const model of this.models) model.advance(this.#app.ticker.deltaMS);
    });
    this.#app.view.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      let point;
      for (const model of this.models) {
        if (!model.effects.settings.gazeFollow) continue;
        point ??= this.#canvasPoint(event.clientX, event.clientY);
        model.display.focus(point.x, point.y);
      }
    });
    this.#app.view.addEventListener("pointerleave", () => {
      for (const model of this.models) {
        if (model.effects.settings.gazeFollow) model.display.internalModel.focusController.focus(0, 0);
      }
    });
    new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width < 1 || height < 1) return;
      this.#app.renderer.resize(width, height);
      this.#toolbarInset = this.#toolbar.offsetHeight + 8;
      for (const model of this.models) this.#place(model);
      this.#drawSelection();
    }).observe(host);
  }

  get placement() {
    return this.#placements.get(this.selected);
  }

  captureFrame() {
    const view = this.#app.view;
    const frame = document.createElement("canvas");
    frame.width = view.width;
    frame.height = view.height;
    this.#highlight.renderable = false;
    try {
      this.#app.render();
      frame.getContext("2d").drawImage(view, 0, 0);
    } finally {
      this.#highlight.renderable = true;
    }
    return frame;
  }

  #canvasPoint(clientX, clientY) {
    const { left, top, width, height } = this.#app.view.getBoundingClientRect();
    return new this.pixi.Point(
      (clientX - left) * this.#app.screen.width / width,
      (clientY - top) * this.#app.screen.height / height
    );
  }

  #pick(clientX, clientY) {
    const point = this.#canvasPoint(clientX, clientY);
    for (let i = this.models.length - 1; i >= 0; i--) {
      const model = this.models[i];
      if (hitsModel(model, point)) return model;
    }
    return null;
  }

  async add(source, onProgress) {
    const model = await ViewerModel.load(this.pixi, source, onProgress);
    model.updatePoseGeometry();
    return this.#attach(model, { bounds: measureModel(model), x: 0, y: 0, angle: 0, size: 100 });
  }

  async copy(model, onProgress) {
    const placement = { ...this.#placements.get(model) };
    const copy = await model.clone(this.pixi, onProgress);
    copy.copyNumber = 1;
    while (this.models.some((existing) =>
      existing.source.name === model.source.name && existing.copyNumber === copy.copyNumber
    )) {
      copy.copyNumber++;
    }
    return this.#attach(copy, placement);
  }

  #attach(model, placement) {
    this.#placements.set(model, placement);
    const index = this.models.length;
    this.models.push(model);
    this.#app.stage.addChildAt(model.display, index);
    this.#place(model);
    return model;
  }

  select(model) {
    this.selected = model;
    this.#drawSelection();
  }

  remove(model) {
    const index = this.models.indexOf(model);
    this.models.splice(index, 1);
    this.#placements.delete(model);
    model.dispose();
    this.select(this.models[index] ?? this.models[index - 1] ?? null);
  }

  reorder(model, index) {
    const previousIndex = this.models.indexOf(model);
    if (index === previousIndex) return;
    this.models.splice(previousIndex, 1);
    this.models.splice(index, 0, model);
    this.#app.stage.setChildIndex(model.display, index);
  }

  setPlacement(changes) {
    Object.assign(this.placement, changes);
    this.placement.size = Math.min(1000, Math.max(10, this.placement.size));
    this.#place(this.selected);
    this.#drawSelection();
  }

  #place(model) {
    const { width, height } = this.#app.screen;
    const { bounds, x, y, angle, size } = this.#placements.get(model);
    const { display } = model;
    const top = Math.min(this.#toolbarInset, height * 0.32);
    const margin = Math.min(32, Math.max(14, width * 0.025));
    const scale = Math.min(width * 0.53 / bounds.width, (height - top) * 0.87 / bounds.height);
    display.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    display.position.set(margin + bounds.width * scale / 2 + x, (height + top) / 2 + y);
    display.scale.set(scale * size / 100);
    display.angle = angle % 360;
  }

  #drawSelection() {
    this.#highlight.clear();
    if (!this.selected) return;
    const { display } = this.selected;
    const { bounds } = this.placement;
    const pad = 6 / display.scale.x;
    this.#highlight.position.copyFrom(display.position);
    this.#highlight.pivot.copyFrom(display.pivot);
    this.#highlight.scale.copyFrom(display.scale);
    this.#highlight.rotation = display.rotation;
    this.#highlight.lineStyle(1.5 / display.scale.x, 0x6d94d7, 0.85);
    this.#highlight.drawRoundedRect(bounds.x - pad, bounds.y - pad,
      bounds.width + 2 * pad, bounds.height + 2 * pad, pad);
  }
}
