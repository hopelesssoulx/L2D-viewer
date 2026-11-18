import { discoverLocalModels } from "./local-model-source.js";
import { ModelScene } from "./scene.js";
import { ParameterPanel } from "./parameter-panel.js";
import { setupBackground, setupInspectorDrag, setupTheme, setupToolbar } from "./workspace-controls.js";

const $ = (id) => document.getElementById(id);

const add = $("add-models");
const folder = $("folder-input");
const modelSelect = $("model-select");
const stage = $("stage");
const report = $("load-report");
const dismissReport = $("dismiss-report");
const inspectorWindow = $("inspector");
const toggleInspector = $("toggle-inspector");
const inspectorEmpty = $("inspector-empty");
const inspectorContent = $("inspector-content");
const motionTools = $("motion-tools");
const motionSelect = $("motion-select");
const motionError = $("motion-error");
const expressionTools = $("expression-tools");
const expressionSelect = $("expression-select");
const expressionError = $("expression-error");
const play = $("play-motion");
const toggle = $("toggle-playback");
const reset = $("reset-parameters");
const remove = $("remove-model");
const playbackState = $("playback-state");
const showParameters = $("show-parameters");
const showJSON = $("show-json");
const jsonView = $("json-view");
const jsonInput = $("parameter-json");
const jsonStatus = $("json-status");
const exportJSON = $("export-json");
const importJSON = $("import-json");

const panel = new ParameterPanel({
  view: $("parameters-view"),
  search: $("parameter-search"),
  count: $("parameter-count"),
  hint: $("parameter-hint"),
  list: $("parameter-list"),
});
let scene;

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

function syncPlayback() {
  const model = scene.selected;
  motionTools.disabled = !model?.motions.length;
  expressionTools.disabled = !model?.expressions.length;
  if (motionTools.disabled) $("motion-popover").hidePopover();
  if (expressionTools.disabled) $("expression-popover").hidePopover();
  toggle.disabled = !model || model.loadingMotion;

  playbackState.hidden = remove.hidden = !model;
  toggle.textContent = model?.paused ? "继续" : "暂停";
  if (!model) return;

  const { paused, loadingMotion, loadingExpression } = model;
  playbackState.textContent = loadingMotion ? "加载动作中" : loadingExpression ? "加载表情中" : paused ? "已暂停" : "实时更新";
  playbackState.dataset.paused = paused;
  play.disabled = motionSelect.disabled = loadingMotion || motionTools.disabled;
  expressionSelect.disabled = loadingExpression || expressionTools.disabled;
  reset.disabled = importJSON.disabled = loadingMotion;
  remove.disabled = loadingMotion || loadingExpression;
  motionError.textContent = model.motionError;
  motionError.hidden = !model.motionError;
  expressionError.textContent = model.expressionError;
  expressionError.hidden = !model.expressionError;
  panel.syncPlayback();
}

function updateSelection() {
  const model = scene.selected;
  modelSelect.value = model ? scene.models.indexOf(model) : "";
  modelSelect.title = model?.source.path ?? "";
  inspectorEmpty.hidden = Boolean(model);
  inspectorContent.hidden = !model;
  panel.select(model);
  if (model) {
    motionSelect.replaceChildren(...model.motions.map(({ label }, index) => new Option(label, index)));
    motionSelect.value = model.motionChoice;
    expressionSelect.replaceChildren(new Option("无表情", -1),
      ...model.expressions.map((label, index) => new Option(label, index)));
    expressionSelect.value = model.expressionChoice;
    setJSONStatus("粘贴参数 JSON 后导入，模型会暂停并应用数值。");
  }
  syncPlayback();
}

function selectModel(model) {
  if (scene.selected === model) return;
  scene.select(model);
  updateSelection();
}

function updateModelList() {
  const count = scene.models.length;
  $("model-count").textContent = `${count} 个模型`;
  $("stage-empty").hidden = count > 0;
  modelSelect.disabled = !count;
  modelSelect.replaceChildren(...(count
    ? scene.models.map((model, index) => new Option(model.name, index))
    : [new Option("未选中", "")]));
  modelSelect.value = count ? scene.models.indexOf(scene.selected) : "";
}

async function importFolder(files) {
  add.disabled = true;
  reportLoad("正在读取模型文件夹…");
  const errors = [];
  try {
    const sources = discoverLocalModels(files);
    for (const source of sources) {
      try {
        const model = await scene.add(source);
        updateModelList();
        if (!scene.selected) selectModel(model);
      } catch (error) {
        errors.push(`${source.path}：${error.message}`);
      }
    }
  } catch (error) {
    errors.push(error.message);
  } finally {
    add.disabled = false;
    reportLoad(errors.length ? "有模型加载失败。" : "", errors);
  }
}

function setPanel(showSnapshot) {
  showParameters.setAttribute("aria-pressed", !showSnapshot);
  showJSON.setAttribute("aria-pressed", showSnapshot);
  panel.view.hidden = showSnapshot;
  jsonView.hidden = !showSnapshot;
  panel.refreshValues();
}

setupToolbar($("toolbar-dock"), $("toolbar"), $("pin-toolbar"), $("reveal-toolbar"));
setupInspectorDrag(inspectorWindow, $("inspector-bar"), $("toolbar"));
setupTheme($("theme-toggle"));
setupBackground(stage, $("background-popover"), $("background-input"), $("upload-background"), $("background-status"));

toggleInspector.addEventListener("click", (event) => {
  setInspector(inspectorWindow.hidden);
  if (!inspectorWindow.hidden && event.detail === 0) $("close-inspector").focus({ preventScroll: true });
});
$("close-inspector").addEventListener("click", () => {
  setInspector(false);
  ($("toolbar").inert ? $("reveal-toolbar") : toggleInspector).focus({ preventScroll: true });
});
dismissReport.addEventListener("click", () => { report.hidden = true; });

try {
  const pixi = globalThis.PIXI;
  if (!globalThis.Live2DCubismCore || !pixi?.live2d?.Live2DModel) {
    throw new Error("无法加载渲染依赖，请检查网络后刷新页面。");
  }
  pixi.live2d.config.sound = false;
  scene = new ModelScene(pixi, stage, selectModel);
} catch (error) {
  add.disabled = true;
  reportLoad("无法启动查看器。", [error.message]);
}

if (scene) {
  add.addEventListener("click", () => folder.click());
  folder.addEventListener("change", () => {
    const files = Array.from(folder.files);
    folder.value = "";
    if (files.length) void importFolder(files);
  });
  modelSelect.addEventListener("change", () => selectModel(scene.models[Number(modelSelect.value)]));
  motionSelect.addEventListener("change", () => {
    scene.selected.motionChoice = Number(motionSelect.value);
  });
  play.addEventListener("click", async () => {
    const pending = scene.selected.playMotion();
    syncPlayback();
    await pending;
    syncPlayback();
  });
  expressionSelect.addEventListener("change", async () => {
    const model = scene.selected;
    const pending = model.setExpression(Number(expressionSelect.value));
    syncPlayback();
    await pending;
    if (scene.selected === model) expressionSelect.value = model.expressionChoice;
    syncPlayback();
  });
  toggle.addEventListener("click", () => {
    scene.selected.paused = !scene.selected.paused;
    syncPlayback();
  });
  reset.addEventListener("click", () => {
    scene.selected.resetParameters();
    syncPlayback();
  });
  remove.addEventListener("click", () => {
    scene.remove(scene.selected);
    updateModelList();
    updateSelection();
    (scene.selected ? modelSelect : add).focus({ preventScroll: true });
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
