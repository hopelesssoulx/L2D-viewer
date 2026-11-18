import { t, ViewerError } from "./i18n.js";
import { readParameterDescriptions } from "./parameter-descriptions.js";
import { readParameterGroups } from "./parameter-groups.js";

function prepareSettings(json, source, live2d) {
  if (!live2d.Cubism4ModelSettings.isValidJSON(json)) {
    throw new ViewerError("invalidModelSettings");
  }

  // Motion sound paths are optional and this viewer only loads visual assets.
  for (const group of Object.values(json.FileReferences.Motions ?? {})) {
    for (const motion of group) delete motion.Sound;
  }

  const settings = new live2d.Cubism4ModelSettings({ ...json, url: source.path });
  const urls = new Map();
  for (const reference of settings.getDefinedFiles()) {
    if (!urls.has(reference)) urls.set(reference, source.fileURL(reference));
  }
  settings.resolveURL = (reference) => urls.get(reference);
  return settings;
}

function readSnapshot(text, parameters) {
  let snapshot;
  try {
    snapshot = JSON.parse(text);
  } catch {
    throw new ViewerError("invalidJSON");
  }

  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new ViewerError("expectedJSONObject");
  }

  const entries = Object.entries(snapshot);
  const byId = new Map(parameters.map((parameter) => [parameter.id, parameter]));
  return entries.map(([id, value]) => {
    const parameter = byId.get(id);
    if (!parameter) throw new ViewerError("unknownParameter", { id });
    if (!Number.isFinite(value) || value < parameter.min || value > parameter.max) {
      throw new ViewerError("parameterBounds", { id, min: parameter.min, max: parameter.max });
    }
    return [parameter.index, value];
  });
}

const expressionBlends = ["Add", "Multiply", "Overwrite"];
const expressionFadeMs = 250;
const manualIdleGroup = Symbol("No automatic idle motion");

export class ViewerModel {
  static async load(pixi, source) {
    const live2d = pixi.live2d;
    const options = { autoUpdate: false, autoInteract: false, motionPreload: "NONE", idleMotionGroup: manualIdleGroup };
    const display = new live2d.Live2DModel(options);
    let textureURLs = [];
    try {
      const modelJSON = await source.readSettings();
      const settings = prepareSettings(modelJSON, source, live2d);
      const descriptions = readParameterDescriptions(source, modelJSON.FileReferences.DisplayInfo);
      const groups = readParameterGroups(settings);
      textureURLs = settings.textures.map((reference) => settings.resolveURL(reference));

      // Complete texture requests before the adapter starts decoding the moc.
      const textures = await Promise.allSettled(textureURLs.map((url) => pixi.Texture.fromURL(url)));
      const failedTexture = textures.findIndex((result) => result.status === "rejected");
      if (failedTexture !== -1) {
        throw new ViewerError("unreadableTexture", { path: settings.textures[failedTexture] });
      }

      const failedOptionals = [];
      display.on("poseLoadError", () => failedOptionals.push(settings.pose));
      display.on("physicsLoadError", () => failedOptionals.push(settings.physics));
      await live2d.Live2DFactory.setupLive2DModel(display, settings, options);
      if (failedOptionals.length) throw new ViewerError("unreadableModelFiles", { paths: failedOptionals.join(", ") });
      return new ViewerModel(display, source, live2d.MotionPriority.FORCE, await descriptions, await groups);
    } catch (error) {
      try {
        if (display.internalModel) display.destroy();
        else pixi.Container.prototype.destroy.call(display);

        for (const url of textureURLs) pixi.utils.TextureCache[url]?.destroy(true);
      } finally {
        source.dispose();
      }
      throw error;
    }
  }

  #core;
  #values;
  #baseValues;
  #animationValues;
  #motionPriority;
  #activeMotion;
  #expressionManager;
  #expression;
  #expressionFade;
  #expressionLayers = new Map();
  #blendedValues;

  constructor(display, source, motionPriority, descriptions, groups) {
    this.display = display;
    this.source = source;
    this.copyNumber = 0;
    this.paused = false;
    this.loadingMotion = false;
    this.motionChoice = -1;
    this.loopMotion = true;
    this.motionError = null;
    this.loadingExpression = false;
    this.expressionChoice = -1;
    this.expressionError = null;
    this.#motionPriority = motionPriority;

    const internal = display.internalModel;
    internal.breath.setParameters(internal.breath.getParameters()
      .filter(({ parameterId }) => parameterId === internal.idParamBreath));
    this.#core = internal.coreModel;
    const parameters = this.#core.getModel().parameters;
    this.parameters = Array.from(parameters.ids, (id, index) => ({
      id,
      index,
      description: descriptions.get(id),
      motion: groups.motion.has(id) || !groups.expression.has(id),
      expression: groups.expression.has(id),
      min: parameters.minimumValues[index],
      max: parameters.maximumValues[index],
      defaultValue: parameters.defaultValues[index],
    }));
    this.#values = Float32Array.from(parameters.values);
    this.#baseValues = this.#values.slice();
    this.#animationValues = new Float32Array(parameters.count);
    this.#blendedValues = new Float32Array(parameters.count);
    this.motions = Object.entries(internal.motionManager.definitions).flatMap(([group, motions]) =>
      motions.map(({ File }, index) => {
        const name = File.split(/[\\/]/).at(-1).replace(/\.motion3\.json$/i, "");
        return { group, index, label: group && group !== name ? `${group} / ${name}` : name };
      })
    );

    this.#expressionManager = internal.motionManager.expressionManager;
    this.expressions = (this.#expressionManager?.definitions ?? []).map(({ Name, File }) =>
      (Name || File.split(/[\\/]/).at(-1)).replace(/\.exp3\.json$/i, "")
    );
    if (this.#expressionManager) {
      const create = this.#expressionManager.createExpression.bind(this.#expressionManager);
      // Some exporters emit Cubism's numeric blend enum.
      this.#expressionManager.createExpression = (data, definition) => create({
        ...data,
        Parameters: (data.Parameters ?? []).map((parameter) => ({
          ...parameter,
          Blend: expressionBlends[parameter.Blend] ?? parameter.Blend,
        })),
      }, definition);
    }

    // The adapter restores its motion-only values just after drawing the pose.
    internal.on("beforeModelUpdate", () => {
      this.#baseValues.set(parameters.values);
      this.#applyExpression(parameters.values);
      this.#values.set(parameters.values);
    });
  }

  get name() {
    const name = this.source.name;
    if (!this.copyNumber) return name;
    return t(this.copyNumber === 1 ? "modelCopy" : "numberedModelCopy", { name, number: this.copyNumber });
  }

  advance(deltaMS) {
    const fading = this.#advanceExpression(deltaMS);
    if (!this.paused && !this.loadingMotion) this.display.update(deltaMS);
    else if (fading) this.#applyPose(true);
  }

  #finishExpressionFade() {
    this.#expressionFade = undefined;
    this.#expressionLayers.clear();
    if (this.#expression) this.#expressionLayers.set(this.#expression, 1);
  }

  #advanceExpression(deltaMS) {
    const fade = this.#expressionFade;
    if (!fade) return false;
    fade.elapsed += deltaMS;
    const progress = Math.min(1, fade.elapsed / expressionFadeMs);
    if (progress === 1) {
      this.#finishExpressionFade();
      return true;
    }
    const weight = progress * progress * (3 - 2 * progress);
    this.#expressionLayers.clear();
    for (const [expression, previousWeight] of fade.layers) {
      this.#expressionLayers.set(expression, previousWeight * (1 - weight));
    }
    if (this.#expression) {
      this.#expressionLayers.set(this.#expression, (this.#expressionLayers.get(this.#expression) ?? 0) + weight);
    }
    return true;
  }

  #applyExpression(values) {
    if (!this.#expressionFade) {
      this.#expression?.doUpdateParameters(this.#core, 0, 1);
      return;
    }

    // Evaluate both expressions on the same pose before mixing their results.
    this.#blendedValues.set(this.#baseValues);
    for (const [expression, weight] of this.#expressionLayers) {
      values.set(this.#baseValues);
      expression.doUpdateParameters(this.#core, 0, 1);
      for (let index = 0; index < values.length; index++) {
        this.#blendedValues[index] += (values[index] - this.#baseValues[index]) * weight;
      }
    }
    values.set(this.#blendedValues);
  }

  async clone(pixi) {
    const values = this.#values.slice();
    const baseValues = this.#baseValues.slice();
    const opacities = this.#core.getModel().parts.opacities.slice();
    const { motionChoice, loopMotion, expressionChoice } = this;
    const copy = await ViewerModel.load(pixi, this.source.clone());
    try {
      copy.paused = true;
      await copy.setExpression(expressionChoice, { immediate: true });
      if (copy.expressionError) throw copy.expressionError;
      copy.motionChoice = motionChoice;
      copy.loopMotion = loopMotion;
      copy.#values.set(values);
      copy.#baseValues.set(baseValues);
      copy.#core.getModel().parts.opacities.set(opacities);
      copy.#applyPose();
      return copy;
    } catch (error) {
      copy.dispose();
      throw error;
    }
  }

  valueAt(index) {
    return this.#values[index];
  }

  setParameter(parameter, value) {
    if (!this.paused || !Number.isFinite(value)) return;
    const clamped = Math.min(parameter.max, Math.max(parameter.min, value));
    this.#baseValues[parameter.index] = this.#values[parameter.index] = clamped;
    this.#applyPose();
  }

  resetParameter(parameter) {
    this.paused = true;
    this.setParameter(parameter, parameter.defaultValue);
  }

  resetParameters() {
    this.paused = true;
    for (const parameter of this.parameters) this.#values[parameter.index] = parameter.defaultValue;
    this.#baseValues.set(this.#values);
    this.#applyPose();
  }

  exportParameters() {
    const changed = this.parameters.filter(({ index, defaultValue }) => this.#values[index] !== defaultValue);
    return JSON.stringify(Object.fromEntries(changed.map(({ id, index }) => [id, this.#values[index]])), null, 2);
  }

  importParameters(text) {
    const entries = readSnapshot(text, this.parameters);
    this.paused = true;
    for (const [index, value] of entries) this.#baseValues[index] = this.#values[index] = value;
    this.#applyPose();
    return entries.length;
  }

  #applyPose(expressionChanged = false) {
    if (!expressionChanged && this.#expressionFade) this.#finishExpressionFade();
    const values = this.#core.getModel().parameters.values;
    this.#animationValues.set(values);
    try {
      values.set(expressionChanged ? this.#baseValues : this.#values);
      if (expressionChanged) {
        // Compose on the held frame so switching expressions never advances a paused motion.
        this.#applyExpression(values);
        this.#values.set(values);
      }
      this.#core.update();
    } finally {
      // Keep the playback baseline and clock intact while editing a still frame.
      values.set(this.#animationValues);
    }
  }

  async setExpression(index, { immediate = false } = {}) {
    if (this.loadingExpression || index === this.expressionChoice) return;
    this.loadingExpression = true;
    this.expressionError = null;
    try {
      const expression = index < 0 ? undefined : await this.#expressionManager.loadExpression(index);
      if (index >= 0 && !expression) throw new ViewerError("expressionFailed");
      this.#expression = expression;
      this.expressionChoice = index;
      if (immediate) this.#finishExpressionFade();
      else this.#expressionFade = { layers: new Map(this.#expressionLayers), elapsed: 0 };
    } catch (error) {
      this.expressionError = error;
    } finally {
      this.loadingExpression = false;
    }
  }

  async playMotion(index = this.motionChoice) {
    const motion = this.motions[index];
    if (!motion || this.loadingMotion) return;
    this.loadingMotion = true;
    if (this.motionChoice >= 0 && this.motionChoice !== index && (this.motionChoice === 0 || index === 0)) {
      this.loopMotion = index === 0;
    }
    this.motionChoice = index;
    this.motionError = null;
    try {
      const manager = this.display.internalModel.motionManager;
      const clip = await manager.loadMotion(motion.group, motion.index);
      if (!clip) throw new ViewerError("motionFailed");
      manager.stopAllMotions();
      this.#activeMotion = undefined;
      this.#configureLoop(clip);
      const started = await this.display.motion(motion.group, motion.index, this.#motionPriority);
      if (!started) throw new ViewerError("motionFailed");
      this.#activeMotion = clip;
      this.paused = false;
    } catch (error) {
      this.motionError = error;
    } finally {
      this.loadingMotion = false;
    }
  }

  setMotionLoop(enabled) {
    this.loopMotion = enabled;
    const manager = this.display.internalModel.motionManager;
    if (!this.#activeMotion) return;
    if (manager.isFinished()) {
      if (enabled && !this.paused) return this.playMotion();
      return;
    }

    // Cubism calculates a queue entry's end time once, on its first frame.
    const entry = manager.queueManager._motions[0];
    this.#configureLoop(this.#activeMotion, entry);
  }

  #configureLoop(clip, entry) {
    const duration = clip.getLoopDuration();
    const hasDuration = Number.isFinite(duration) && duration > 0;
    const loop = this.loopMotion && hasDuration;
    clip.setIsLoop(loop);
    if (entry?.isStarted()) {
      entry.setEndTime(loop || !hasDuration ? -1 : entry.getStartTime() + duration);
    }
  }

  dispose() {
    try {
      this.display.destroy({ texture: true, baseTexture: true });
    } finally {
      this.source.dispose();
    }
  }
}
