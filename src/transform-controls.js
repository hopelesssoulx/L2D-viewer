const resetValues = {
  position: { x: 0, y: 0 },
  rotation: { angle: 0 },
  size: { size: 100 },
};

export function setupTransformControls(host, getPlacement, update) {
  const fields = [...host.querySelectorAll("[data-placement-field]")];
  let hold;

  function refresh() {
    const placement = getPlacement();
    if (!placement) return;
    for (const input of fields) input.value = placement[input.dataset.placementField];
  }

  function step(button, placement) {
    const { axis, increment } = button.dataset;
    update({ [axis]: placement[axis] + Number(increment) });
    refresh();
  }

  function stop() {
    if (!hold) return;
    clearTimeout(hold.timer);
    delete hold.button.dataset.held;
    hold = undefined;
  }

  function start(button, id) {
    const placement = getPlacement();
    if (hold || !placement || host.hidden) return;
    hold = { button, id };
    button.dataset.held = "";
    function repeat() {
      if (host.hidden || getPlacement() !== placement) {
        stop();
        return;
      }
      step(button, placement);
      hold.timer = setTimeout(repeat, 65);
    }
    hold.timer = setTimeout(repeat, 250);
  }

  for (const input of fields) {
    input.addEventListener("input", () => {
      const value = input.valueAsNumber;
      if (getPlacement() && Number.isFinite(value)) update({ [input.dataset.placementField]: value });
    });
    input.addEventListener("blur", refresh);
  }

  host.addEventListener("pointerdown", (event) => {
    const button = event.target.closest("button[data-axis]");
    if (button && event.button === 0 && !hold) {
      start(button, event.pointerId);
      if (hold) button.setPointerCapture(event.pointerId);
    }
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    host.addEventListener(type, (event) => {
      if (hold?.id === event.pointerId) stop();
    });
  }
  host.addEventListener("contextmenu", (event) => {
    if (event.target.closest("button[data-axis]")) event.preventDefault();
  });

  for (const type of ["keydown", "keyup"]) {
    host.addEventListener(type, (event) => {
      const button = event.target.closest("button[data-axis]");
      if (!button || ![" ", "Enter"].includes(event.key)) return;
      event.preventDefault();
      if (type === "keydown" && !event.repeat) start(button, "keyboard");
      if (type === "keyup" && hold?.id === "keyboard") stop();
    });
  }
  host.addEventListener("focusout", () => {
    if (hold?.id === "keyboard") stop();
  });
  window.addEventListener("blur", stop);

  host.addEventListener("click", (event) => {
    const placement = getPlacement();
    const button = event.target.closest("button");
    if (!button || !placement) return;
    if (button.dataset.axis && event.detail === 0) step(button, placement);
    const changes = resetValues[button.dataset.reset];
    if (changes) {
      update(changes);
      refresh();
    }
  });

  return refresh;
}
