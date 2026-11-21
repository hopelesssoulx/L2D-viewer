import { AnimationControls } from "./animation-controls.js";
import { getLanguage, setLanguage, t, translatePage, ViewerError } from "./i18n.js";
import { discoverLocalModels } from "./local-model-source.js";
import { ModelStrip } from "./model-strip.js";
import { setupMotionProgress } from "./motion-progress.js";
import { ModelScene } from "./scene.js";
import { ParameterPanel } from "./parameter-panel.js";
import { readResourceCatalog, resourceModelName, ResourceModelSource } from "./resource-model-source.js";
import { setupTransformControls } from "./transform-controls.js";
import { setupBackground, setupFloatingPanel, setupTheme, setupToolbar } from "./workspace-controls.js";

const $ = (id) => document.getElementById(id);

const add = $("add-models");
const resourceModels = $("resource-models");
const folder = $("folder-input");
const toolbar = $("toolbar");
const stage = $("stage");
const report = $("load-report");
const loadProgress = $("load-progress");
const dismissReport = $("dismiss-report");
const animationWindow = $("animation-window");
const toggleAnimation = $("toggle-animation");
const inspectorWindow = $("inspector");
const toggleInspector = $("toggle-inspector");
const transformWindow = $("transform-window");
const toggleTransform = $("toggle-transform");
const playbackButtons = [$("toggle-playback"), $("inspector-playback")];
const reset = $("reset-parameters");
const copy = $("copy-model");
const remove = $("remove-model");
const playbackState = $("playback-state");
const showParameters = $("show-parameters");
const showExpressionParameters = $("show-expression-parameters");
const showJSON = $("show-json");
const jsonView = $("json-view");
const jsonInput = $("parameter-json");
const jsonStatus = $("json-status");
const exportJSON = $("export-json");
const importJSON = $("import-json");

let scene;
let loadingModels = false;
let renderLoadReport = () => {};
let renderJSONStatus = () => {};
const panel = new ParameterPanel({
  view: $("parameters-view"),
  search: $("parameter-search"),
  count: $("parameter-count"),
  hint: $("parameter-hint"),
  list: $("parameter-list"),
  onPlayback: syncPlayback,
});
const animation = new AnimationControls(
  animationWindow, $("motion-loop-template"), [...document.querySelectorAll("[data-loop-host]")],
  () => scene?.selected, syncPlayback
);
const refreshMotionProgress = setupMotionProgress(
  $("inspector-motion-progress"), () => scene?.selected, syncPlayback
);
const strip = new ModelStrip($("model-strip"), toggleSelection, (model, index) => {
  scene.reorder(model, index);
  strip.render(scene.models, scene.selected);
});
const refreshTransform = setupTransformControls(
  transformWindow, () => scene?.placement, (changes) => scene.setPlacement(changes)
);

function reportLoad(key, { errors = [], args, progress } = {}) {
  report.hidden = !key;
  loadProgress.hidden = !progress;
  if (progress) {
    loadProgress.max = progress.max;
    if (progress.value === undefined) loadProgress.removeAttribute("value");
    else loadProgress.value = progress.value;
  }
  renderLoadReport = () => {
    $("load-message").textContent = key ? t(key, args) : "";
    dismissReport.hidden = !errors.length;
    const list = $("load-errors");
    list.hidden = !errors.length;
    list.replaceChildren(...errors.map(({ path, model, error }) => {
      const li = document.createElement("li");
      const name = path ?? model?.name;
      const message = error.message ?? String(error);
      li.textContent = name ? t("assetFailure", { path: name, message }) : message;
      return li;
    }));
  };
  renderLoadReport();
}

function setJSONStatus(message, error = false) {
  renderJSONStatus = () => {
    jsonStatus.textContent = message();
    jsonStatus.classList.toggle("error", error);
  };
  renderJSONStatus();
}

function setAnimation(open) {
  animationWindow.hidden = !open;
  toggleAnimation.setAttribute("aria-expanded", open);
  if (open) revealAnimation();
}

function setInspector(open) {
  inspectorWindow.hidden = !open;
  toggleInspector.setAttribute("aria-expanded", open);
  if (open) {
    revealInspector();
    panel.refreshValues();
    refreshMotionProgress();
  }
}

function setTransform(open) {
  transformWindow.hidden = !open;
  toggleTransform.setAttribute("aria-expanded", open);
  if (open) {
    revealTransform();
    refreshTransform();
  }
}

function syncPlayback() {
  const model = scene.selected;
  animation.sync();
  refreshMotionProgress();
  const busy = model?.loadingMotion || model?.loadingExpression;
  add.disabled = loadingModels;
  resourceModels.disabled = loadingModels || resourceModels.options.length < 2;
  copy.disabled = loadingModels || !model || busy;
  remove.disabled = loadingModels || !model || busy;
  for (const button of playbackButtons) {
    button.disabled = !model || model.loadingMotion;
    button.textContent = t(model?.paused ? "resume" : "pause");
  }
  toggleAnimation.disabled = toggleInspector.disabled = toggleTransform.disabled = !model;
  if (!model) {
    playbackState.textContent = "";
    return;
  }

  const { paused, loadingMotion, loadingExpression } = model;
  playbackState.textContent = t(loadingMotion ? "loadingMotion" : loadingExpression ? "loadingExpression" : paused ? "paused" : "updating");
  playbackState.dataset.paused = paused;
  reset.disabled = importJSON.disabled = loadingMotion;
  panel.syncPlayback();
}

function updateSelection() {
  const model = scene.selected;
  strip.render(scene.models, model);
  strip.reveal(model);
  panel.select(model);
  animation.select();
  if (!model) {
    setAnimation(false);
    setInspector(false);
    setTransform(false);
  } else {
    refreshTransform();
    setJSONStatus(() => t("jsonHint"));
  }
  syncPlayback();
}

function selectModel(model, openModelPanels = false) {
  const previous = scene.selected;
  scene.select(model);
  updateSelection();
  if (model && (openModelPanels || !previous)) {
    setTransform(true);
    setAnimation(true);
  }
}

function toggleSelection(model) {
  selectModel(scene.selected === model ? null : model);
}

function updateModelList() {
  const count = scene.models.length;
  $("model-count").textContent = t(count === 1 ? "oneModel" : "modelCount", { count });
  $("stage-empty").hidden = count > 0;
  strip.render(scene.models, scene.selected);
}

async function populateResourceModels() {
  try {
    const groups = await readResourceCatalog();
    resourceModels.append(...groups.map(([label, paths]) => {
      const group = document.createElement("optgroup");
      group.label = label;
      group.append(...paths.map((path) => new Option(resourceModelName(path), path)));
      return group;
    }));
  } catch {
    const placeholder = resourceModels.options[0];
    placeholder.dataset.i18n = "resourceListUnavailable";
    placeholder.textContent = t("resourceListUnavailable");
  }
  syncPlayback();
}

async function importModels(getSources, readingStatus) {
  if (loadingModels) return;
  loadingModels = true;
  syncPlayback();
  if (readingStatus) reportLoad(readingStatus, { progress: { max: 1 } });
  const errors = [];
  let latest;
  try {
    const sources = getSources();
    for (const [index, source] of sources.entries()) {
      reportLoad("loadingModel", {
        args: { name: source.name, current: index + 1, total: sources.length },
        progress: { value: index, max: sources.length },
      });
      try {
        latest = await scene.add(source, (fraction) => { loadProgress.value = index + fraction; });
        updateModelList();
      } catch (error) {
        errors.push({ path: source.path, error });
      }
    }
  } catch (error) {
    errors.push({ error });
  } finally {
    loadingModels = false;
    if (latest) selectModel(latest, true);
    else syncPlayback();
    reportLoad(errors.length ? "importFailures" : "", { errors });
  }
}

async function copySelected() {
  const original = scene.selected;
  loadingModels = true;
  syncPlayback();
  reportLoad("copyingModel", { progress: { value: 0, max: 1 } });
  try {
    const model = await scene.copy(original, (fraction) => { loadProgress.value = fraction; });
    updateModelList();
    selectModel(model, true);
    reportLoad("");
  } catch (error) {
    reportLoad("copyFailure", { errors: [{ model: original, error }] });
  } finally {
    loadingModels = false;
    syncPlayback();
  }
}

function setPanel(category) {
  const showSnapshot = category === "snapshot";
  showParameters.setAttribute("aria-pressed", category === "motion");
  showExpressionParameters.setAttribute("aria-pressed", category === "expression");
  showJSON.setAttribute("aria-pressed", showSnapshot);
  panel.view.hidden = showSnapshot;
  jsonView.hidden = !showSnapshot;
  if (!showSnapshot) panel.showCategory(category);
}

function setupPanelToggle(button, close, window, setOpen) {
  button.addEventListener("click", (event) => {
    setOpen(window.hidden);
    if (!window.hidden && event.detail === 0) close.focus({ preventScroll: true });
  });
  close.addEventListener("click", () => {
    setOpen(false);
    (toolbar.inert ? $("reveal-toolbar") : button).focus({ preventScroll: true });
  });
}

const localizeToolbar = setupToolbar($("toolbar-dock"), toolbar, $("pin-toolbar"), $("reveal-toolbar"));
const floatingPanels = [animationWindow, inspectorWindow, transformWindow];
function bringForward(panel) {
  for (const floatingPanel of floatingPanels) floatingPanel.toggleAttribute("data-front", panel === floatingPanel);
}
const revealAnimation = setupFloatingPanel(animationWindow, bringForward);
const revealInspector = setupFloatingPanel(inspectorWindow, bringForward);
const revealTransform = setupFloatingPanel(transformWindow, bringForward);
const localizeTheme = setupTheme($("theme-toggle"));
new ResizeObserver(() => {
  if (!transformWindow.hidden) {
    document.documentElement.style.setProperty("--transform-height", `${transformWindow.offsetHeight}px`);
  }
}).observe(transformWindow);
const localizeBackground = setupBackground(stage, $("background-popover"), $("background-input"), $("upload-background"), $("background-status"));
setupPanelToggle(toggleAnimation, $("close-animation"), animationWindow, setAnimation);
setupPanelToggle(toggleInspector, $("close-inspector"), inspectorWindow, setInspector);
setupPanelToggle(toggleTransform, $("close-transform"), transformWindow, setTransform);
dismissReport.addEventListener("click", () => { report.hidden = true; });

try {
  const pixi = globalThis.PIXI;
  if (!globalThis.Live2DCubismCore || !pixi?.live2d?.Live2DModel) {
    throw new ViewerError("missingRuntime");
  }
  pixi.live2d.config.sound = false;
  scene = new ModelScene(pixi, stage, toolbar, toggleSelection, (model, changes) => {
    if (scene.selected !== model) selectModel(model);
    scene.setPlacement(changes);
    refreshTransform();
  });
} catch (error) {
  add.disabled = true;
  reportLoad("startFailure", { errors: [{ error }] });
}

if (scene) {
  const mouseControl = $("canvas-mouse");
  mouseControl.checked = false;
  mouseControl.addEventListener("change", () => scene.setMouseControls(mouseControl.checked));
  add.addEventListener("click", () => folder.click());
  folder.addEventListener("change", () => {
    const files = Array.from(folder.files);
    folder.value = "";
    if (files.length) void importModels(() => discoverLocalModels(files), "loadingModels");
  });
  resourceModels.addEventListener("change", () => {
    const path = resourceModels.value;
    resourceModels.value = "";
    if (path) void importModels(() => [new ResourceModelSource(path)]);
  });
  void populateResourceModels();
  for (const button of playbackButtons) {
    button.addEventListener("click", () => {
      scene.selected.paused = !scene.selected.paused;
      syncPlayback();
    });
  }
  reset.addEventListener("click", () => {
    scene.selected.resetParameters();
    syncPlayback();
  });
  copy.addEventListener("click", copySelected);
  remove.addEventListener("click", () => {
    scene.remove(scene.selected);
    updateModelList();
    updateSelection();
    if (scene.selected) strip.focus(scene.selected);
    else add.focus({ preventScroll: true });
  });
  showParameters.addEventListener("click", () => setPanel("motion"));
  showExpressionParameters.addEventListener("click", () => setPanel("expression"));
  showJSON.addEventListener("click", () => setPanel("snapshot"));
  exportJSON.addEventListener("click", () => {
    jsonInput.value = scene.selected.exportParameters();
    jsonInput.focus();
    jsonInput.select();
    setJSONStatus(() => t("jsonExported"));
  });
  importJSON.addEventListener("click", () => {
    try {
      const count = scene.selected.importParameters(jsonInput.value);
      syncPlayback();
      setJSONStatus(() => t("jsonApplied", { count }));
    } catch (error) {
      setJSONStatus(() => error.message, true);
    }
  });

  window.setInterval(() => {
    if (!inspectorWindow.hidden && scene.selected) {
      panel.refreshValues();
      refreshMotionProgress();
    }
  }, 80);
}

function localizeViewer() {
  translatePage();
  localizeToolbar();
  localizeTheme();
  localizeBackground();
  animation.select();
  panel.localize();
  if (scene) {
    updateModelList();
    syncPlayback();
  } else {
    $("model-count").textContent = t("modelCount", { count: 0 });
  }
  renderLoadReport();
  renderJSONStatus();
}

const languageSelect = $("language-select");
languageSelect.value = getLanguage();
languageSelect.addEventListener("change", () => {
  setLanguage(languageSelect.value);
  localizeViewer();
});
localizeViewer();
