export function setupTransformControls(host, getPlacement, update) {
  const fields = [...host.querySelectorAll("[data-placement-field]")];

  function refresh() {
    const placement = getPlacement();
    if (!placement) return;
    for (const input of fields) input.value = placement[input.dataset.placementField];
  }

  for (const input of fields) {
    input.addEventListener("input", () => {
      const value = input.valueAsNumber;
      if (getPlacement() && Number.isFinite(value)) update({ [input.dataset.placementField]: value });
    });
    input.addEventListener("blur", refresh);
  }

  host.addEventListener("click", (event) => {
    const placement = getPlacement();
    const button = event.target.closest("button");
    if (!button || !placement) return;
    const { axis, increment, reset } = button.dataset;
    if (axis) update({ [axis]: placement[axis] + Number(increment) });
    if (reset === "position") update({ x: 0, y: 0 });
    if (reset === "rotation") update({ angle: 0 });
    refresh();
  });

  return refresh;
}
