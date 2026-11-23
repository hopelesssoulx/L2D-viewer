function fillGlow(context, width, height, x, y, color, stop) {
  const radiusX = Math.max(x, width - x) * Math.SQRT2;
  const radiusY = Math.max(y, height - y) * Math.SQRT2;
  context.save();
  context.translate(x, y);
  context.scale(radiusX, radiusY);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, color);
  gradient.addColorStop(stop, "transparent");
  context.fillStyle = gradient;
  context.fillRect(-x / radiusX, -y / radiusY, width / radiusX, height / radiusY);
  context.restore();
}

function drawBackground(canvas, frame, stage, image) {
  const context = canvas.getContext("2d");
  const { width, height } = stage.getBoundingClientRect();
  const style = getComputedStyle(stage);
  context.scale(canvas.width / width, canvas.height / height);
  context.fillStyle = style.backgroundColor;
  context.fillRect(0, 0, width, height);

  if (image) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const imageWidth = image.naturalWidth * scale;
    const imageHeight = image.naturalHeight * scale;
    context.drawImage(image, (width - imageWidth) / 2, (height - imageHeight) / 2, imageWidth, imageHeight);
  } else if (!stage.dataset.background) {
    fillGlow(context, width, height, width * 0.83, height * 0.76, style.getPropertyValue("--stage-glow"), 0.60);
    fillGlow(context, width, height, width * 0.21, height * 0.24, style.getPropertyValue("--stage-light"), 0.63);
  }

  if (!stage.hasAttribute("data-dots-hidden")) {
    context.fillStyle = style.getPropertyValue("--stage-dot");
    context.beginPath();
    for (let x = (width / 2) % 22; x < width; x += 22) {
      for (let y = (height / 2) % 22; y < height; y += 22) {
        context.moveTo(x + 1.25, y);
        context.arc(x, y, 1.25, 0, Math.PI * 2);
      }
    }
    context.fill();
  }
  context.drawImage(frame, 0, 0, width, height);
}

export function setupCanvasExport(popover, stage, captureFrame, getBackgroundImage) {
  const buttons = [...popover.querySelectorAll("[data-export-background]")];
  const error = popover.querySelector("[role=status]");
  popover.addEventListener("beforetoggle", (event) => {
    if (event.newState === "open") error.hidden = true;
  });

  for (const button of buttons) {
    button.addEventListener("click", async () => {
      error.hidden = true;
      for (const option of buttons) option.disabled = true;
      try {
        const frame = captureFrame();
        let canvas = frame;
        const withBackground = button.dataset.exportBackground === "visible";
        if (withBackground) {
          canvas = document.createElement("canvas");
          canvas.width = frame.width;
          canvas.height = frame.height;
          drawBackground(canvas, frame, stage, getBackgroundImage());
        }
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("PNG encoding failed");
        const url = URL.createObjectURL(blob);
        const download = document.createElement("a");
        download.href = url;
        download.download = withBackground ? "live2d.png" : "live2d-transparent.png";
        download.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {
        error.hidden = false;
      } finally {
        for (const option of buttons) option.disabled = false;
      }
    });
  }
}
