export function setupToolbar(dock, toolbar, pin, reveal) {
  const popovers = [...toolbar.querySelectorAll("[popovertarget]")].map((trigger) => ({
    trigger,
    panel: document.getElementById(trigger.getAttribute("popovertarget")),
  }));
  let pinned = true;
  let timer;

  function expand(expanded) {
    dock.dataset.expanded = expanded;
    toolbar.inert = !expanded;
    reveal.hidden = expanded;
  }

  function scheduleCollapse() {
    clearTimeout(timer);
    if (pinned) return;
    timer = setTimeout(() => {
      const keyboardFocus = document.activeElement?.matches(":focus-visible")
        && toolbar.contains(document.activeElement);
      if (!dock.matches(":hover") && !keyboardFocus && !popovers.some(({ panel }) => panel.matches(":popover-open"))) {
        expand(false);
      }
    }, 200);
  }

  function positionPopover(trigger, panel) {
    const top = toolbar.offsetHeight + 8;
    const left = Math.max(8, Math.min(trigger.getBoundingClientRect().left, window.innerWidth - 328));
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
    panel.style.setProperty("--popover-top", `${top}px`);
  }

  for (const { trigger, panel } of popovers) {
    panel.addEventListener("beforetoggle", (event) => {
      if (event.newState === "open") positionPopover(trigger, panel);
    });
    panel.addEventListener("toggle", (event) => {
      trigger.dataset.open = event.newState === "open";
      if (event.newState === "closed") scheduleCollapse();
    });
  }
  function updateGeometry() {
    document.documentElement.style.setProperty("--toolbar-height", `${toolbar.offsetHeight}px`);
    for (const { trigger, panel } of popovers) {
      if (panel.matches(":popover-open")) positionPopover(trigger, panel);
    }
  }
  window.addEventListener("resize", updateGeometry);
  new ResizeObserver(updateGeometry).observe(toolbar);

  pin.addEventListener("click", () => {
    pinned = !pinned;
    pin.setAttribute("aria-pressed", pinned);
    pin.title = pinned ? "取消固定后，移出功能栏会自动收起" : "开启后，功能栏会保持显示。鼠标移到网页顶边可展开。";
    if (pinned) expand(true);
    else scheduleCollapse();
  });
  reveal.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") expand(true);
  });
  function revealWithFocus() {
    expand(true);
    toolbar.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
  }
  reveal.addEventListener("click", revealWithFocus);
  reveal.addEventListener("focus", () => {
    if (reveal.matches(":focus-visible")) revealWithFocus();
  });
  dock.addEventListener("pointerenter", () => clearTimeout(timer));
  dock.addEventListener("pointerleave", scheduleCollapse);
  dock.addEventListener("focusout", scheduleCollapse);
  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" && !pinned && !dock.contains(event.target)
      && !popovers.some(({ panel }) => panel.contains(event.target))) {
      expand(false);
    }
  });
}

export function setupTheme(button) {
  const root = document.documentElement;
  const preferenceKey = "l2d-viewer-theme";

  function setTheme(theme) {
    const dark = theme === "dark";
    root.dataset.theme = theme;
    button.setAttribute("aria-checked", dark);
    button.title = dark ? "切换到浅色模式" : "切换到深色模式";
  }

  setTheme(root.dataset.theme);
  button.addEventListener("click", () => {
    const theme = root.dataset.theme === "dark" ? "light" : "dark";
    setTheme(theme);
    try {
      localStorage.setItem(preferenceKey, theme);
    } catch {
      // Keep the selection for the current page.
    }
  });
}

export function setupFloatingPanel(panel, bringForward) {
  const handle = panel.querySelector(".inspector-bar");
  let drag;

  panel.addEventListener("pointerdown", () => bringForward(panel));
  handle.addEventListener("pointerdown", (event) => {
    if (drag || event.button !== 0 || event.target.closest("button")) return;
    const { left, top } = panel.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX - left, y: event.clientY - top };
    handle.setPointerCapture(drag.id);
  });
  handle.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    panel.dataset.moved = "";
    panel.style.setProperty("--panel-x", `${event.clientX - drag.x}px`);
    panel.style.setProperty("--panel-y", `${event.clientY - drag.y}px`);
  });
  handle.addEventListener("lostpointercapture", () => { drag = undefined; });

  return () => {
    const { left, top, right, bottom } = handle.getBoundingClientRect();
    if (right < 16 || left > innerWidth - 16 || bottom < 12 || top > innerHeight - 12) {
      delete panel.dataset.moved;
    }
    bringForward(panel);
  };
}

export function setupBackground(stage, popup, input, upload, status) {
  const presets = [...popup.querySelectorAll("[data-background]")];
  let imageURL = null;
  let choice = 0;

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle("error", error);
    status.hidden = !message;
  }

  function setBackground(type, value, selectedPreset) {
    if (imageURL) URL.revokeObjectURL(imageURL);
    imageURL = type === "image" ? value : null;
    if (type) stage.dataset.background = type;
    else delete stage.dataset.background;
    stage.style.setProperty("--custom-background", imageURL ? `url("${imageURL}")` : value);
    for (const preset of presets) preset.setAttribute("aria-pressed", preset === selectedPreset);
  }

  for (const preset of presets) {
    preset.addEventListener("click", () => {
      choice++;
      const { background } = preset.dataset;
      setBackground(background ? "solid" : "", background, preset);
      setStatus("");
    });
  }
  upload.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const [file] = input.files;
    input.value = "";
    if (!file) return;
    const revision = ++choice;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      URL.revokeObjectURL(url);
      if (revision === choice) setStatus("无法读取这张图片。", true);
      return;
    }

    if (revision !== choice) {
      URL.revokeObjectURL(url);
      return;
    }
    setBackground("image", url);
    setStatus(file.name);
  });
}
