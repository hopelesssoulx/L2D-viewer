const formatValue = (value) => String(Number(value.toFixed(5)));
const svgNamespace = "http://www.w3.org/2000/svg";

export class ParameterPanel {
  #model = null;
  #rows = [];

  constructor({ view, search, count, hint, list, onPlayback }) {
    this.view = view;
    this.search = search;
    this.count = count;
    this.hint = hint;
    this.list = list;
    this.onPlayback = onPlayback;
    this.search.addEventListener("input", () => this.#filter());
  }

  select(model) {
    this.#model = model;
    this.search.value = "";
    this.#rows = (model?.parameters ?? []).map((parameter) => this.#createRow(model, parameter));
    this.list.replaceChildren(...this.#rows.map(({ row }) => row));
    this.list.scrollTop = 0;
    this.#filter();
    this.syncPlayback();
  }

  #createRow(model, parameter) {
    const { id, index, min, max, defaultValue, description } = parameter;
    const row = document.createElement("div");
    row.className = "parameter-row";

    const header = document.createElement("div");
    header.className = "parameter-header";
    const label = document.createElement("label");
    label.textContent = id;
    label.title = description;
    const limits = document.createElement("small");
    limits.textContent = `${formatValue(min)} – ${formatValue(max)} · 默认 ${formatValue(defaultValue)}`;
    header.append(label, limits);

    const inputs = document.createElement("div");
    inputs.className = "parameter-inputs";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.setAttribute("aria-label", `${id} 滑块`);
    const number = document.createElement("input");
    number.type = "number";
    number.id = `parameter-${index}`;
    number.setAttribute("aria-description", description);
    label.htmlFor = number.id;

    for (const input of [slider, number]) {
      input.min = min;
      input.max = max;
      input.step = "any";
    }
    slider.addEventListener("input", () => {
      model.setParameter(parameter, slider.valueAsNumber);
      number.value = formatValue(model.valueAt(index));
    });
    number.addEventListener("change", () => {
      model.setParameter(parameter, number.valueAsNumber);
      number.value = formatValue(model.valueAt(index));
      slider.value = model.valueAt(index);
    });
    number.addEventListener("blur", () => {
      number.value = formatValue(model.valueAt(index));
    });

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "parameter-reset";
    reset.title = "恢复默认值";
    reset.setAttribute("aria-label", `重置 ${id}`);
    const icon = document.createElementNS(svgNamespace, "svg");
    icon.setAttribute("aria-hidden", "true");
    const symbol = document.createElementNS(svgNamespace, "use");
    symbol.setAttribute("href", "./assets/icons.svg#reset");
    icon.append(symbol);
    reset.append(icon);
    reset.addEventListener("click", () => {
      model.resetParameter(parameter);
      this.onPlayback();
    });

    inputs.append(slider, number, reset);
    row.append(header, inputs);
    return { row, slider, number, reset, index, matches: true, filterKey: id.toLowerCase() };
  }

  #filter() {
    const query = this.search.value.trim().toLowerCase();
    let matches = 0;
    for (const entry of this.#rows) {
      entry.matches = entry.filterKey.includes(query);
      entry.row.hidden = !entry.matches;
      if (entry.matches) matches++;
    }
    this.count.textContent = query ? `${matches} / ${this.#rows.length}` : `${matches} 项`;
    this.refreshValues();
  }

  syncPlayback() {
    const canEdit = this.#model?.paused && !this.#model.loadingMotion;
    this.hint.textContent = canEdit ? "拖动滑块或输入数值调整当前姿势。" : "播放时实时更新，暂停后可编辑。";
    for (const { slider, number, reset } of this.#rows) {
      slider.disabled = !canEdit;
      number.readOnly = !canEdit;
      reset.disabled = this.#model.loadingMotion || this.#model.loadingExpression;
    }
    this.refreshValues();
  }

  refreshValues() {
    if (!this.#model || this.view.hidden) return;
    for (const { slider, number, index, matches } of this.#rows) {
      if (!matches) continue;
      const value = this.#model.valueAt(index);
      if (document.activeElement !== slider && slider.valueAsNumber !== value) slider.value = value;
      if (number.readOnly || document.activeElement !== number) {
        const formatted = formatValue(value);
        if (number.value !== formatted) number.value = formatted;
      }
    }
  }
}
