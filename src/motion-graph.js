const margin = { left: 42, right: 14, top: 13, bottom: 23 };
const format = (value) => String(Number(value.toFixed(2)));
const limit = (value, min, max) => Math.max(min, Math.min(max, value));

export function setupMotionGraph(canvas, { seek, selectKey, moveKey }) {
  const context = canvas.getContext("2d");
  let state;
  let plot;
  let pointer;

  function redraw() {
    const { width, height } = canvas.getBoundingClientRect();
    if (!state || width <= margin.left + margin.right || height <= margin.top + margin.bottom) return;
    const { keys, parameter, time, duration, restricted, selectedKey } = state;
    let min = parameter?.min ?? -1;
    let max = parameter?.max ?? 1;
    for (const key of keys) {
      min = Math.min(min, key.value, key.handles?.[1] ?? key.value, key.handles?.[3] ?? key.value);
      max = Math.max(max, key.value, key.handles?.[1] ?? key.value, key.handles?.[3] ?? key.value);
    }
    max = Math.max(max, min + 1e-5);
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const x = (value) => margin.left + value / duration * innerWidth;
    const y = (value) => margin.top + (max - value) / (max - min) * innerHeight;
    plot = { x, y, innerWidth, innerHeight, min, max, duration };
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const style = getComputedStyle(canvas);
    const line = style.getPropertyValue("--line");
    const accent = style.getPropertyValue("--accent");
    const text = style.getPropertyValue("--muted");
    context.font = "11px system-ui";
    context.strokeStyle = line;
    context.fillStyle = text;
    context.lineWidth = 1;
    context.beginPath();
    for (let step = 0; step <= 4; step++) {
      const fraction = step / 4;
      const positionX = x(fraction * duration);
      const positionY = margin.top + fraction * innerHeight;
      context.moveTo(positionX, margin.top);
      context.lineTo(positionX, height - margin.bottom);
      context.moveTo(margin.left, positionY);
      context.lineTo(width - margin.right, positionY);
      context.textAlign = step === 4 ? "right" : "center";
      context.fillText(format(fraction * duration) + "s", positionX, height - 6);
      context.textAlign = "right";
      context.fillText(format(max - fraction * (max - min)), margin.left - 5, positionY + 4);
    }
    context.stroke();

    context.strokeStyle = accent;
    context.globalAlpha = 0.65;
    context.beginPath();
    context.moveTo(x(time), margin.top);
    context.lineTo(x(time), height - margin.bottom);
    context.stroke();
    context.globalAlpha = 1;
    if (!keys.length) return;

    context.save();
    context.beginPath();
    context.rect(margin.left - 6, margin.top - 6, innerWidth + 12, innerHeight + 12);
    context.clip();
    context.strokeStyle = accent;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x(0), y(keys[0].value));
    context.lineTo(x(keys[0].time), y(keys[0].value));
    for (let index = 1; index < keys.length; index++) {
      const start = keys[index - 1];
      const end = keys[index];
      if (end.type === 1) {
        const [t1, v1, t2, v2] = end.handles;
        const span = end.time - start.time;
        context.bezierCurveTo(x(restricted ? start.time + span / 3 : t1), y(v1),
          x(restricted ? start.time + span * 2 / 3 : t2), y(v2), x(end.time), y(end.value));
        continue;
      }
      if (end.type === 2) context.lineTo(x(end.time), y(start.value));
      if (end.type === 3) context.lineTo(x(start.time), y(end.value));
      context.lineTo(x(end.time), y(end.value));
    }
    context.lineTo(x(duration), y(keys.at(-1).value));
    context.stroke();
    for (const [index, key] of keys.entries()) {
      context.fillStyle = index === selectedKey ? style.getPropertyValue("--primary") : accent;
      context.beginPath();
      context.arc(x(key.time), y(key.value), index === selectedKey ? 5 : 3.5, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function readPointer(event) {
    const { left, top } = canvas.getBoundingClientRect();
    const x = event.clientX - left;
    const y = event.clientY - top;
    const fraction = limit((x - margin.left) / plot.innerWidth, 0, 1);
    const value = plot.max - limit((y - margin.top) / plot.innerHeight, 0, 1) * (plot.max - plot.min);
    return { x, y, time: fraction * plot.duration, value };
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!plot || event.button !== 0 || pointer) return;
    const { x, y, time } = readPointer(event);
    const keys = state.keys;
    let closest = -1;
    let distance = 9;
    for (const [index, key] of keys.entries()) {
      const offset = Math.hypot(x - plot.x(key.time), y - plot.y(key.value));
      if (offset < distance) {
        distance = offset;
        closest = index;
      }
    }
    pointer = { id: event.pointerId, key: closest };
    canvas.setPointerCapture(event.pointerId);
    if (closest >= 0) selectKey(closest);
    else seek(time);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (pointer?.id !== event.pointerId) return;
    const { time, value } = readPointer(event);
    if (pointer.key >= 0) moveKey(pointer.key, time, value);
    else seek(time);
  });
  canvas.addEventListener("lostpointercapture", () => { pointer = undefined; });
  new ResizeObserver(redraw).observe(canvas);
  return (next) => {
    state = next;
    redraw();
  };
}
