import { AnimationControls } from "./animation-controls.js";
import { discoverLocalModels } from "./local-model-source.js";
import { ModelStrip } from "./model-strip.js";
import { ModelScene } from "./scene.js";
import { ParameterPanel } from "./parameter-panel.js";
import { setupTransformControls } from "./transform-controls.js";
import { setupBackground, setupInspectorDrag, setupTheme, setupToolbar } from "./workspace-controls.js";

const $ = (id) => document.getElementById(id);

const add = $("add-models");
const folder = $("folder-input");
const toolbar = $("toolbar");
const stage = $("stage");
const report = $("load-report");
const dismissReport = $("dismiss-report");
const inspectorWindow = $("inspector");
const toggleInspector = $("toggle-inspector");
const transformWindow = $("transform-window");
const toggleTransform = $("toggle-transform");
const togglePlayback = $("toggle-playback");
const reset = $("reset-parameters");
const copy = $("copy-model");
const remove = $("remove-model");
const playbackState = $("playback-state");
const showParameters = $("show-parameters");
const showJSON = $("show-json");
const jsonView = $("json-view");
const jsonInput = $("parameter-json");
const jsonStatus = $("json-status");
const exportJSON = $("export-json");
const importJSON = $("import-json");

let scene;
let loadingModels = false;
const panel = new ParameterPanel({
  view: $("parameters-view"),
  search: $("parameter-search"),
  count: $("parameter-count"),
  hint: $("parameter-hint"),
  list: $("parameter-list"),
  onPlayback: syncPlayback,
});
const animation = new AnimationControls(
  $("animation-template"), [$("toolbar-animation"), $("inspector-animation")],
  () => scene?.selected, syncPlayback
);
const strip = new ModelStrip($("model-strip"), toggleSelection, (model, index) => {
  scene.reorder(model, index);
  strip.render(scene.models, scene.selected);
});
const refreshTransform = setupTransformControls(
  transformWindow, () => scene?.placement, (changes) => scene.setPlacement(changes)
);

function reportLoad(message, errors = []) {
  report.hidden = !message;
  $("load-message").textContent = message;
  dismissReport.hidden = !errors.length;
  const list = $("load-errors");
  list.hidden = !errors.length;
  list.replaceChildren(...errors.map((message) => {
    const li = document.createElement("li");
    li.textContent = message;
    return li;
  }));
}

function setJSONStatus(message, error = false) {
  jsonStatus.textContent = message;
  jsonStatus.classList.toggle("error", error);
}

function setInspector(open) {
  inspectorWindow.hidden = !open;
  toggleInspector.setAttribute("aria-expanded", open);
  if (open) panel.refreshValues();
}

function setTransform(open) {
  transformWindow.hidden = !open;
  toggleTransform.setAttribute("aria-expanded", open);
  if (open) refreshTransform();
}

function syncPlayback() {
  const model = scene.selected;
  animation.sync();
  const busy = model?.loadingMotion || model?.loadingExpression;
  add.disabled = loadingModels;
  copy.disabled = loadingModels || !model || busy;
  remove.disabled = loadingModels || !model || busy;
  togglePlayback.disabled = !model || model.loadingMotion;
  togglePlayback.textContent = model?.paused ? "继续" : "暂停";
  toggleInspector.disabled = toggleTransform.disabled = !model;
  if (!model) {
    playbackState.textContent = "";
    return;
  }

  const { paused, loadingMotion, loadingExpression } = model;
  playbackState.textContent = loadingMotion ? "加载动作中" : loadingExpression ? "加载表情中" : paused ? "已暂停" : "实时更新";
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
    setInspector(false);
    setTransform(false);
  } else {
    refreshTransform();
    setJSONStatus("粘贴参数 JSON 后导入，模型会暂停并应用数值。");
  }
  syncPlayback();
}

function selectModel(model, openTransform = false) {
  const previous = scene.selected;
  scene.select(model);
  updateSelection();
  if (model && (openTransform || !previous)) setTransform(true);
}

function toggleSelection(model) {
  selectModel(scene.selected === model ? null : model);
}

function updateModelList() {
  const count = scene.models.length;
  $("model-count").textContent = `${count} 个模型`;
  $("stage-empty").hidden = count > 0;
  strip.render(scene.models, scene.selected);
}

async function importFolder(files) {
  loadingModels = true;
  syncPlayback();
  reportLoad("正在读取模型文件夹…");
  const errors = [];
  let latest;
  try {
    const sources = discoverLocalModels(files);
    for (const source of sources) {
      try {
        latest = await scene.add(source);
        updateModelList();
      } catch (error) {
        errors.push(`${source.path}：${error.message}`);
      }
    }
  } catch (error) {
    errors.push(error.message);
  } finally {
    loadingModels = false;
    if (latest) selectModel(latest, true);
    else syncPlayback();
    reportLoad(errors.length ? "有模型加载失败。" : "", errors);
  }
}

async function copySelected() {
  const original = scene.selected;
  loadingModels = true;
  syncPlayback();
  reportLoad("正在复制模型…");
  try {
    const model = await scene.copy(original);
    updateModelList();
    selectModel(model, true);
    reportLoad("");
  } catch (error) {
    reportLoad("复制模型失败。", [`${original.name}：${error.message}`]);
  } finally {
    loadingModels = false;
    syncPlayback();
  }
}

function setPanel(showSnapshot) {
  showParameters.setAttribute("aria-pressed", !showSnapshot);
  showJSON.setAttribute("aria-pressed", showSnapshot);
  panel.view.hidden = showSnapshot;
  jsonView.hidden = !showSnapshot;
  panel.refreshValues();
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

setupToolbar($("toolbar-dock"), toolbar, $("pin-toolbar"), $("reveal-toolbar"));
setupInspectorDrag(inspectorWindow, $("inspector-bar"), toolbar);
setupTheme($("theme-toggle"));
new ResizeObserver(() => {
  if (!transformWindow.hidden) {
    document.documentElement.style.setProperty("--transform-height", `${transformWindow.offsetHeight}px`);
  }
}).observe(transformWindow);
setupBackground(stage, $("background-popover"), $("background-input"), $("upload-background"), $("background-status"));
setupPanelToggle(toggleInspector, $("close-inspector"), inspectorWindow, setInspector);
setupPanelToggle(toggleTransform, $("close-transform"), transformWindow, setTransform);
dismissReport.addEventListener("click", () => { report.hidden = true; });

try {
  const pixi = globalThis.PIXI;
  if (!globalThis.Live2DCubismCore || !pixi?.live2d?.Live2DModel) {
    throw new Error("无法加载渲染依赖，请检查网络后刷新页面。");
  }
  pixi.live2d.config.sound = false;
  scene = new ModelScene(pixi, stage, toolbar, toggleSelection, (model, changes) => {
    if (scene.selected !== model) selectModel(model);
    scene.setPlacement(changes);
    refreshTransform();
  });
} catch (error) {
  add.disabled = true;
  reportLoad("无法启动查看器。", [error.message]);
}

if (scene) {
  const mouseControl = $("canvas-mouse");
  mouseControl.checked = false;
  mouseControl.addEventListener("change", () => scene.setMouseControls(mouseControl.checked));
  add.addEventListener("click", () => folder.click());
  folder.addEventListener("change", () => {
    const files = Array.from(folder.files);
    folder.value = "";
    if (files.length && !loadingModels) void importFolder(files);
  });
  togglePlayback.addEventListener("click", () => {
    scene.selected.paused = !scene.selected.paused;
    syncPlayback();
  });
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
  showParameters.addEventListener("click", () => setPanel(false));
  showJSON.addEventListener("click", () => setPanel(true));
  exportJSON.addEventListener("click", () => {
    jsonInput.value = scene.selected.exportParameters();
    jsonInput.focus();
    jsonInput.select();
    setJSONStatus("已导出当前姿势参数。可直接复制所选文本。");
  });
  importJSON.addEventListener("click", () => {
    try {
      const count = scene.selected.importParameters(jsonInput.value);
      syncPlayback();
      setJSONStatus(`已应用 ${count} 项参数。`);
    } catch (error) {
      setJSONStatus(error.message, true);
    }
  });

  window.setInterval(() => {
    if (!inspectorWindow.hidden && scene.selected && !scene.selected.paused) panel.refreshValues();
  }, 80);
}
