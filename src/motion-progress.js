export function setupMotionProgress(host, template, getModel, onPlayback) {
  const row = document.createElement("div");
  row.className = "motion-progress";
  row.append(host.querySelector(".animation-loop"), template.content.cloneNode(true));
  host.querySelector(".animation-expression").before(row);

  const slider = row.querySelector("input[type=range]");
  const number = row.querySelector("input[type=number]");
  const total = row.querySelector("span[data-last-frame]");

  function refresh(force = false) {
    const { frame = 0, lastFrame = 0 } = getModel()?.motionProgress ?? {};
    const maximum = String(lastFrame);
    const value = String(frame);
    slider.disabled = number.disabled = lastFrame === 0;
    if (slider.max !== maximum) slider.max = number.max = maximum;
    if (slider.value !== value) slider.value = value;
    if ((force || document.activeElement !== number) && number.value !== value) number.value = value;
    const label = lastFrame ? `/ ${lastFrame}` : "/ —";
    if (total.textContent !== label) total.textContent = label;
  }

  async function seek(value) {
    const model = getModel();
    if (model && Number.isFinite(value)) {
      await model.seekMotion(value);
      onPlayback();
    }
    refresh(true);
  }

  slider.addEventListener("input", () => seek(slider.valueAsNumber));
  number.addEventListener("change", () => seek(number.valueAsNumber));
  number.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      number.blur();
    }
  });
  number.addEventListener("blur", () => refresh(true));
  refresh();
  return refresh;
}
