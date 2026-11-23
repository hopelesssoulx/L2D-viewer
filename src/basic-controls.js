export function setupBasicControls(panel, getModel) {
  const controls = [...panel.querySelectorAll("[data-effect]")];

  function refresh() {
    const effects = getModel()?.effects;
    if (!effects) return;
    const { settings, supported } = effects;
    for (const input of controls) {
      const { effect, requires, unit } = input.dataset;
      const available = supported[requires ?? effect];
      input.disabled = !available || Boolean(requires && !settings[requires]);
      if (input.type === "checkbox") {
        input.checked = available && settings[effect];
      } else {
        const value = String(settings[effect]);
        if (input.value !== value) input.value = value;
        input.parentElement.querySelector("output").value = value + unit;
        input.parentElement.querySelector("[data-reset-effect]").disabled = !available;
      }
    }
  }

  panel.addEventListener("input", (event) => {
    const input = event.target;
    const { effect } = input.dataset;
    const model = getModel();
    if (!effect || !model || input.disabled) return;
    const value = input.type === "checkbox" ? input.checked : input.valueAsNumber;
    model.effects.set({ [effect]: value });
    refresh();
  });

  panel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reset-effect]");
    const effects = getModel()?.effects;
    if (!button || button.disabled || !effects) return;
    effects.reset(button.dataset.resetEffect);
    refresh();
  });

  return refresh;
}
