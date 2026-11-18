import { discoverLocalModels } from "./local-model-source.js";
import { ModelScene } from "./scene.js";
import { ParameterPanel } from "./parameter-panel.js";

const $ = (id) => document.getElementById(id);

const add = $("add-models");
const folder = $("folder-input");
const modelList = $("model-list");
const activeModel = $("active-model");
const empty = $("inspector-empty");
const inspector = $("inspector-content");
const motionSelect = $("motion-select");
const motionError = $("motion-error");
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

const controls = new Map();
const panel = new ParameterPanel({
  view: $("parameters-view"),
  search: $("parameter-search"),
  count: $("parameter-count"),
  hint: $("parameter-hint"),
  list: $("parameter-list"),
});
let scene;

function reportLoad(message, errors = []) {
  $("load-report").hidden = false;
  $("load-message").textContent = message;
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

function syncPlayback() {
  const model = scene.selected;
  if (!model) return;

  playbackState.textContent = model.loadingMotion ? "加载动作中" : model.paused ? "已暂停" : "实时更新";
  playbackState.dataset.paused = model.paused;
  toggle.textContent = model.paused ? "继续播放" : "暂停";
  play.disabled = motionSelect.disabled = model.loadingMotion || !model.motions.length;
  toggle.disabled = reset.disabled = remove.disabled = importJSON.disabled = model.loadingMotion;
  motionError.textContent = model.motionError;
  motionError.hidden = !model.motionError;
  for (const [item, { state }] of controls) {
    state.textContent = item.loadingMotion ? "加载中" : item.paused ? "暂停" : "";
  }
  panel.syncPlayback();
}

function updateSelection() {
  const model = scene.selected;
  for (const [item, { button }] of controls) button.setAttribute("aria-pressed", item === model);
  empty.hidden = Boolean(model);
  inspector.hidden = playbackState.hidden = !model;
  panel.select(model);
  if (!model) return;

  activeModel.textContent = model.name;
  activeModel.title = model.source.path;
  const options = model.motions.map(({ label }, index) => new Option(label, index));
  motionSelect.replaceChildren(...(options.length ? options : [new Option("无动作文件", "")]));
  motionSelect.value = options.length ? model.motionChoice : "";
  setJSONStatus("粘贴参数 JSON 后导入，模型会暂停并应用数值。");
  syncPlayback();
}

function selectModel(model) {
  if (scene.selected === model) return;
  scene.select(model);
  updateSelection();
}

function updateModelCount() {
  const count = scene.models.length;
  $("model-count").textContent = `${count} 个模型`;
  $("stage-empty").hidden = $("model-list-empty").hidden = count > 0;
}

function addModelButton(model) {
  const button = document.createElement("button");
  button.type = "button";
  button.title = model.source.path;
  button.setAttribute("aria-pressed", "false");
  const name = document.createElement("span");
  name.textContent = model.name;
  const state = document.createElement("span");
  button.append(name, state);
  button.addEventListener("click", () => selectModel(model));
  controls.set(model, { button, state });
  modelList.append(button);
}

async function importFolder(files) {
  add.disabled = true;
  reportLoad("正在读取模型文件夹…");
  let loaded = 0;
  const errors = [];
  try {
    const sources = discoverLocalModels(files);
    for (const source of sources) {
      try {
        const model = await scene.add(source);
        loaded++;
        addModelButton(model);
        updateModelCount();
        if (!scene.selected) selectModel(model);
      } catch (error) {
        errors.push(`${source.path}：${error.message}`);
      }
    }
  } catch (error) {
    errors.push(error.message);
  } finally {
    add.disabled = false;
    reportLoad(loaded ? `已导入 ${loaded} 个模型${errors.length ? `，${errors.length} 个加载失败` : ""}。` : "导入失败。", errors);
  }
}

function setPanel(showSnapshot) {
  showParameters.setAttribute("aria-pressed", !showSnapshot);
  showJSON.setAttribute("aria-pressed", showSnapshot);
  panel.view.hidden = showSnapshot;
  jsonView.hidden = !showSnapshot;
  panel.refreshValues();
}

try {
  const pixi = globalThis.PIXI;
  if (!globalThis.Live2DCubismCore || !pixi?.live2d?.Live2DModel) {
    throw new Error("无法加载渲染依赖，请检查网络后刷新页面。");
  }
  pixi.live2d.config.sound = false;
  scene = new ModelScene(pixi, $("stage"), selectModel);
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
  motionSelect.addEventListener("change", () => {
    scene.selected.motionChoice = Number(motionSelect.value);
  });
  play.addEventListener("click", async () => {
    const pending = scene.selected.playMotion();
    syncPlayback();
    await pending;
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
    const model = scene.selected;
    controls.get(model).button.remove();
    controls.delete(model);
    scene.remove(model);
    updateModelCount();
    updateSelection();
    (controls.get(scene.selected)?.button ?? add).focus();
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
    if (scene.selected && !scene.selected.paused) panel.refreshValues();
  }, 80);
}
