const messages = {
  canvas: ["模型画布", "Model canvas"],
  importModels: ["导入 Live2D 模型", "Import Live2D models"],
  importHint: ["拖入模型文件夹，或点击 + 选择文件夹。", "Drop a model folder here, or use + to choose a folder."],
  importFolder: ["导入文件夹", "Import folder"],
  dropFolders: ["松开以导入文件夹", "Drop to import folders"],
  resourceModels: ["仓库模型", "Resources"],
  resourceListUnavailable: ["列表不可用", "Unavailable"],
  toolbar: ["功能栏", "Toolbar"],
  showToolbar: ["展开功能栏", "Show toolbar"],
  pin: ["固定", "Pin"],
  pinToolbar: ["固定功能栏", "Pin toolbar"],
  unpinHint: ["取消固定后，移出功能栏会自动收起", "Unpin to hide the toolbar when the pointer leaves"],
  pinHint: ["开启后，功能栏会保持显示。鼠标移到网页顶边可展开。", "Pin to keep the toolbar visible. Move to the top edge to reveal it."],
  layers: ["模型图层，右侧在上层", "Model layers, with the rightmost model on top"],
  reorderLayer: ["拖动调整图层", "Drag to reorder the layer"],
  modelCount: ["{count} 个模型", "{count} models"],
  oneModel: ["{count} 个模型", "{count} model"],
  copy: ["复制", "Copy"],
  copyModel: ["复制选中的模型", "Copy selected model"],
  modelCopy: ["{name} 副本", "{name} copy"],
  numberedModelCopy: ["{name} 副本 {number}", "{name} copy {number}"],
  remove: ["移除", "Remove"],
  removeModel: ["移除选中的模型", "Remove selected model"],
  parametersShort: ["参数", "Params"],
  inspectorSuffix: ["检查器", ""],
  inspector: ["参数检查器", "Parameter inspector"],
  closeInspector: ["关闭参数检查器", "Close parameter inspector"],
  inspectorPanels: ["检查器面板", "Inspector panels"],
  liveParameters: ["实时参数", "Live parameters"],
  motionParameters: ["动作参数", "Motion parameters"],
  expressionParameters: ["表情参数", "Expression parameters"],
  motionParameterTab: ["动作参数", "Motion"],
  expressionParameterTab: ["表情参数", "Expression"],
  snapshot: ["JSON 快照", "JSON snapshot"],
  snapshotTab: ["JSON 快照", "JSON"],
  resetAll: ["重置全部参数", "Reset all"],
  findParameter: ["搜索参数 ID", "Search parameter IDs"],
  parameterJSON: ["参数 JSON", "Parameter JSON"],
  exportJSON: ["导出当前参数", "Export parameters"],
  importJSON: ["导入 JSON", "Import JSON"],
  jsonHint: ["粘贴参数 JSON 后导入，模型会暂停并应用数值。", "Paste and import parameter JSON to pause the model and apply the values."],
  jsonExported: ["已导出当前姿势参数。可直接复制所选文本。", "The current pose is selected and ready to copy."],
  jsonApplied: ["已应用 {count} 项参数。", "Applied {count} parameter values."],
  invalidJSON: ["JSON 格式无效。请输入以参数 ID 为键、数值为值的对象。", "Invalid JSON. Enter an object with parameter IDs as keys and numbers as values."],
  expectedJSONObject: ['请输入 JSON 对象，例如 {"ParamAngleX": 10}。', 'Enter a JSON object such as {"ParamAngleX": 10}.'],
  unknownParameter: ["当前模型没有参数 {id}。", "This model has no parameter named {id}."],
  parameterBounds: ["{id} 必须是 {min} 到 {max} 之间的数值。", "{id} must be a number between {min} and {max}."],
  parameterRange: ["{min} – {max} · 默认 {value}", "{min} – {max} · Default {value}"],
  parameterSlider: ["{id} 滑块", "{id} slider"],
  parameterReset: ["重置 {id}", "Reset {id}"],
  resetDefault: ["恢复默认值", "Restore default value"],
  parameterCount: ["{count} 项", "{count} parameters"],
  oneParameter: ["{count} 项", "{count} parameter"],
  editParameterHint: ["拖动滑块或输入数值调整当前姿势。", "Use the slider or enter a value to adjust the current pose."],
  liveParameterHint: ["播放时实时更新，暂停后可编辑。", "Values update during playback. Pause to edit."],
  noParameterDescription: ["模型未提供此参数的描述", "The model provides no description for this parameter"],
  transform: ["变换", "Transform"],
  modelTransform: ["模型变换", "Model transform"],
  closeTransform: ["关闭模型变换", "Close model transform"],
  moveDirections: ["移动方向", "Move directions"],
  moveUp: ["向上移动", "Move up"],
  moveLeft: ["向左移动", "Move left"],
  moveDown: ["向下移动", "Move down"],
  moveRight: ["向右移动", "Move right"],
  positionX: ["横向位置", "Horizontal position"],
  positionY: ["纵向位置", "Vertical position"],
  resetPosition: ["重置位置", "Reset position"],
  resetPositionHint: ["重置到展示区左侧", "Reset to the left of the canvas"],
  rotateLeft: ["逆时针旋转", "Rotate counterclockwise"],
  rotateRight: ["顺时针旋转", "Rotate clockwise"],
  angle: ["角度", "Angle"],
  rotationAngle: ["旋转角度", "Rotation angle"],
  resetRotation: ["重置旋转", "Reset rotation"],
  shrink: ["缩小模型", "Shrink model"],
  enlarge: ["放大模型", "Enlarge model"],
  size: ["大小", "Size"],
  sizePercentage: ["模型大小百分比", "Model size percentage"],
  resetSize: ["重置大小", "Reset size"],
  mouseControls: ["鼠标操控", "Mouse controls"],
  mouseControlHint: ["拖动模型移动，在模型上滚动缩放", "Drag a model to move it. Scroll over it to zoom."],
  pause: ["暂停", "Pause"],
  resume: ["继续", "Resume"],
  paused: ["已暂停", "Paused"],
  updating: ["实时更新", "Updating live"],
  animation: ["动画", "Animation"],
  animationPanel: ["动作与表情", "Motions and expressions"],
  closeAnimation: ["关闭动作与表情", "Close motions and expressions"],
  motion: ["动作", "Motion"],
  expression: ["表情", "Expression"],
  replay: ["（重）播放", "(Re)play"],
  motionLoop: ["动作循环", "Loop motion"],
  loopOn: ["循环", "Loop"],
  loopOff: ["不循环", "Once"],
  motionProgress: ["动作进度", "Motion progress"],
  motionFrame: ["当前动作帧", "Current motion frame"],
  noMotion: ["无动作", "No motion"],
  noExpression: ["无表情", "No expression"],
  loadingMotion: ["加载动作中", "Loading motion"],
  loadingExpression: ["加载表情中", "Loading expression"],
  motionFailed: ["无法加载或播放所选动作。", "Could not load or play the selected motion."],
  expressionFailed: ["无法加载所选表情。", "Could not load the selected expression."],
  background: ["背景", "BG"],
  canvasBackground: ["画布背景", "Canvas background"],
  backgroundPresets: ["预设颜色", "Preset colors"],
  defaultColor: ["默认", "Default"],
  white: ["白色", "White"],
  mistBlue: ["雾蓝", "Mist blue"],
  lightPink: ["浅粉", "Light pink"],
  charcoal: ["炭黑", "Charcoal"],
  greenScreen: ["绿幕", "Green screen"],
  uploadImage: ["上传图片", "Upload image"],
  invalidImage: ["无法读取这张图片。", "Could not read this image."],
  darkMode: ["深色模式", "Dark mode"],
  toLight: ["切换到浅色模式", "Switch to light mode"],
  toDark: ["切换到深色模式", "Switch to dark mode"],
  language: ["界面语言", "Interface language"],
  loadingStatus: ["模型加载状态", "Model loading status"],
  loadingProgress: ["模型加载进度", "Model loading progress"],
  closeLoadingStatus: ["关闭导入提示", "Dismiss import status"],
  loadingModels: ["正在读取模型文件夹…", "Reading model folder…"],
  dropModelFolder: ["请拖入包含模型和资源的文件夹。", "Drop a folder containing the model and its assets."],
  unreadableDroppedFolder: ["无法读取拖入的文件夹。请用 + 选择该文件夹。", "Could not read the dropped folder. Use + to choose it."],
  loadingModel: ["正在加载 {name}（{current}/{total}）", "Loading {name} ({current}/{total})"],
  importFailures: ["有模型加载失败。", "Some models failed to load."],
  copyingModel: ["正在复制模型…", "Copying model…"],
  copyFailure: ["复制模型失败。", "Could not copy the model."],
  startFailure: ["无法启动查看器。", "Could not start the viewer."],
  missingRuntime: ["无法加载渲染依赖，请检查网络后刷新页面。", "The rendering libraries could not load. Check your connection and reload."],
  invalidModelJSON: ["模型描述文件无法读取，或不是有效的 JSON。", "The model description could not be read or contains invalid JSON."],
  missingModelAsset: ["文件夹中缺少模型引用的文件：{path}", "The folder is missing a file referenced by the model: {path}"],
  missingSharedModelAsset: ["找不到共享资源 {path}。请选择同时包含模型和共享资源的上级文件夹。", "Shared file {path} was not found. Choose a parent folder containing the model and its shared files."],
  noModelJSON: ["所选文件夹中找不到 .model3.json 或 model.json。", "No .model3.json or model.json file was found in the selected folder."],
  invalidModelSettings: ["模型描述文件缺少有效的模型或贴图配置。", "The model description lacks valid model or texture entries."],
  unreadableTexture: ["无法读取贴图：{path}", "Could not read texture: {path}"],
  unreadableModelFiles: ["无法读取模型文件：{paths}", "Could not read model files: {paths}"],
  assetFailure: ["{path}：{message}", "{path}: {message}"],
};

const storageKey = "l2d-viewer-language";
let language = "zh";
try {
  if (localStorage.getItem(storageKey) === "en") language = "en";
} catch {
  // The default locale is available without storage.
}

export function getLanguage() {
  return language;
}

export function setLanguage(next) {
  language = next === "en" ? "en" : "zh";
  try {
    localStorage.setItem(storageKey, language);
  } catch {
    // Keep the selection for the current page.
  }
}

export function t(key, values = {}) {
  const template = messages[key]?.[language === "en" ? 1 : 0] ?? key ?? "";
  return template.replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
}

export function translatePage() {
  document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const attribute of ["aria-label", "title", "placeholder"]) {
    const name = `data-i18n-${attribute}`;
    for (const element of document.querySelectorAll(`[${name}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(name)));
    }
  }
}

export class ViewerError extends Error {
  constructor(key, values) {
    super();
    this.key = key;
    this.values = values;
  }

  get message() {
    return t(this.key, this.values);
  }
}
