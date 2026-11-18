import { ViewerModel } from "./live2d-model.js";

export class ModelScene {
  models = [];
  selected = null;
  #app;
  #highlight;
  #slots = [];

  constructor(pixi, host, onSelect) {
    this.pixi = pixi;
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
    this.#app.stage.interactive = true;
    this.#app.stage.hitArea = this.#app.screen;
    this.#app.stage.on("pointertap", (event) => {
      const { x, y } = event.data.global;
      const slot = this.#slots.find(({ left, top, width, height }) =>
        x >= left && x < left + width && y >= top && y < top + height
      );
      if (slot) onSelect(slot.model);
    });
    this.#app.ticker.add(() => {
      for (const model of this.models) model.advance(this.#app.ticker.deltaMS);
    });
    new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width < 1 || height < 1) return;
      this.#app.renderer.resize(width, height);
      this.#layout();
    }).observe(host);
  }

  async add(source) {
    const model = await ViewerModel.load(this.pixi, source);
    this.models.push(model);
    this.#app.stage.addChild(model.display);
    this.#layout();
    return model;
  }

  select(model) {
    this.selected = model;
    this.#layout();
  }

  remove(model) {
    const index = this.models.indexOf(model);
    this.models.splice(index, 1);
    model.dispose();
    this.select(this.models[index] ?? this.models[index - 1] ?? null);
  }

  #layout() {
    const { width, height } = this.#app.screen;
    const count = this.models.length;
    this.#highlight.clear();
    this.#slots = [];
    if (!count || width < 1 || height < 1) return;

    const columns = Math.min(Math.ceil(Math.sqrt(count)), Math.max(1, Math.floor(width / 195)));
    const rows = Math.ceil(count / columns);
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    const inset = Math.min(12, cellWidth * 0.07, cellHeight * 0.07);

    this.models.forEach((model, index) => {
      const row = Math.floor(index / columns);
      const rowCount = Math.min(columns, count - row * columns);
      const left = (width - rowCount * cellWidth) / 2 + (index % columns) * cellWidth;
      const top = row * cellHeight;
      const { display } = model;
      const { width: modelWidth, height: modelHeight } = display.internalModel;
      const scale = Math.min((cellWidth - 2 * inset) / modelWidth, (cellHeight - 2 * inset) / modelHeight);
      display.anchor.set(0.5);
      display.position.set(left + cellWidth / 2, top + cellHeight / 2);
      display.scale.set(scale);
      this.#slots.push({ model, left, top, width: cellWidth, height: cellHeight });

      if (count > 1 && model === this.selected) {
        this.#highlight.lineStyle(1, 0xa8e7bd, 0.45);
        this.#highlight.beginFill(0xa8e7bd, 0.04);
        this.#highlight.drawRoundedRect(left + inset, top + inset,
          cellWidth - 2 * inset, cellHeight - 2 * inset, 10);
        this.#highlight.endFill();
      }
    });
  }
}
