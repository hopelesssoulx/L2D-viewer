import { t } from "./i18n.js";
import { describeParameter } from "./parameter-descriptions.js";

const formatValue = (value) => String(Number(value.toFixed(5)));
const svgNamespace = "http://www.w3.org/2000/svg";

export class ParameterPanel {
  #model = null;
  #rows = [];
  #category = "motion";

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
    this.localize();
  }

  showCategory(category) {
    this.#category = category;
    this.list.scrollTop = 0;
    this.#filter();
  }

  localize() {
    for (const { parameter, label, limits, slider, number, reset } of this.#rows) {
      const { id, min, max, defaultValue } = parameter;
      const description = describeParameter(id, parameter.description);
      label.title = description;
      number.setAttribute("aria-description", description);
      limits.textContent = t("parameterRange", {
        min: formatValue(min), max: formatValue(max), value: formatValue(defaultValue),
      });
      slider.setAttribute("aria-label", t("parameterSlider", { id }));
      reset.title = t("resetDefault");
      reset.setAttribute("aria-label", t("parameterReset", { id }));
    }
    this.#filter();
    this.syncPlayback();
  }

  #createRow(model, parameter) {
    const { id, index, min, max } = parameter;
    const row = document.createElement("div");
    row.className = "parameter-row";

    const header = document.createElement("div");
    header.className = "parameter-header";
    const label = document.createElement("label");
    label.textContent = id;
    const limits = document.createElement("small");
    header.append(label, limits);

    const inputs = document.createElement("div");
    inputs.className = "parameter-inputs";
    const slider = document.createElement("input");
    slider.type = "range";
    const number = document.createElement("input");
    number.type = "number";
    number.id = `parameter-${index}`;
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
    return { row, parameter, label, limits, slider, number, reset, index, matches: true, filterKey: id.toLowerCase() };
  }

  #filter() {
    const query = this.search.value.trim().toLowerCase();
    let count = 0;
    let matches = 0;
    for (const entry of this.#rows) {
      const inCategory = entry.parameter[this.#category];
      if (inCategory) count++;
      entry.matches = inCategory && entry.filterKey.includes(query);
      entry.row.hidden = !entry.matches;
      if (entry.matches) matches++;
    }
    this.count.textContent = query ? `${matches} / ${count}`
      : t(matches === 1 ? "oneParameter" : "parameterCount", { count: matches });
    this.refreshValues();
  }

  syncPlayback() {
    const canEdit = this.#model?.paused && !this.#model.loadingMotion;
    this.hint.textContent = t(canEdit ? "editParameterHint" : "liveParameterHint");
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
