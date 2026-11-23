import {
  createCubism2Pose, cubism2MotionEntry, sampleCubism2Motion, setupCubism2Expressions, setupCubism2Motions,
} from "./cubism2.js";
import { t, ViewerError } from "./i18n.js";
import { setupModelEffects } from "./model-effects.js";
import { inferDisplayGroup, readParameterDisplayInfo } from "./parameter-display-info.js";
import { readParameterGroups } from "./parameter-groups.js";

function prepareSettings(json, source, live2d) {
  const runtime = live2d.Live2DFactory.findRuntime(json);
  if (!runtime) {
    throw new ViewerError("invalidModelSettings");
  }

  // Motion sound paths are optional and this viewer only loads visual assets.
  for (const group of Object.values(json.FileReferences?.Motions ?? json.motions ?? {})) {
    for (const motion of group) {
      delete motion.Sound;
      delete motion.sound;
    }
  }

  const settings = runtime.createModelSettings({ ...json, url: source.path });
  const urls = new Map();
  for (const reference of settings.getDefinedFiles()) {
    if (!urls.has(reference)) urls.set(reference, source.fileURL(reference));
  }
  settings.resolveURL = (reference) => urls.get(reference);
  return settings;
}

function createCubism4Pose(core) {
  const { parameters, parts } = core.getModel();
  return {
    parameters,
    readParts: () => parts.opacities.slice(),
    writeParts: (values) => parts.opacities.set(values),
    save: () => core.saveParameters(),
    update: () => core.update(),
  };
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

const expressionBlends = ["Add", "Add", "Overwrite"];
const expressionFadeMs = 250;
const manualIdleGroup = Symbol("No automatic idle motion");

export class ViewerModel {
  static async load(pixi, source, onProgress) {
    const live2d = pixi.live2d;
    const options = { autoUpdate: false, autoInteract: false, motionPreload: "NONE", idleMotionGroup: manualIdleGroup };
    const display = new live2d.Live2DModel(options);
    let textureURLs = [];
    try {
      const modelJSON = await source.readSettings();
      const settings = prepareSettings(modelJSON, source, live2d);
      const cubism2 = settings instanceof live2d.Cubism2ModelSettings;
      const displayInfo = readParameterDisplayInfo(source, modelJSON.FileReferences?.DisplayInfo);
      const groups = readParameterGroups(settings, cubism2);
      textureURLs = settings.textures.map((reference) => settings.resolveURL(reference));
      // Model loading has three milestones: settings, textures, and scene attachment.
      onProgress?.(1 / 3);

      // Complete texture requests before the adapter starts decoding the moc.
      const textures = await Promise.allSettled(textureURLs.map((url) => pixi.Texture.fromURL(url)));
      const failedTexture = textures.findIndex((result) => result.status === "rejected");
      if (failedTexture !== -1) {
        throw new ViewerError("unreadableTexture", { path: settings.textures[failedTexture] });
      }
      onProgress?.(2 / 3);

      const failedOptionals = [];
      display.on("poseLoadError", () => failedOptionals.push(settings.pose));
      display.on("physicsLoadError", () => failedOptionals.push(settings.physics));
      await live2d.Live2DFactory.setupLive2DModel(display, settings, options);
      if (failedOptionals.length) throw new ViewerError("unreadableModelFiles", { paths: failedOptionals.join(", ") });
      return new ViewerModel(display, source, live2d, cubism2, await displayInfo, await groups);
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
  #pose;
  #values;
  #baseValues;
  #animationValues;
  #initialPartOpacities;
  #motionPriority;
  #activeMotion;
  #activeMotionIndex = -1;
  #previewEntry;
  #expressionManager;
  #expression;
  #expressionFade;
  #expressionLayers = new Map();
  #blendedValues;

  constructor(display, source, live2d, cubism2, displayInfo, groups) {
    this.display = display;
    this.source = source;
    this.cubism2 = cubism2;
    this.copyNumber = 0;
    this.paused = false;
    this.loadingMotion = false;
    this.motionChoice = -1;
    this.loopMotion = false;
    this.motionError = null;
    this.loadingExpression = false;
    this.expressionChoice = -1;
    this.expressionError = null;
    this.#motionPriority = live2d.MotionPriority.FORCE;

    const internal = display.internalModel;
    this.#core = internal.coreModel;
    if (cubism2) {
      this.#pose = createCubism2Pose(internal);
      setupCubism2Motions(internal.motionManager);
    } else {
      this.#pose = createCubism4Pose(this.#core);
    }
    const { parameters } = this.#pose;
    this.effects = setupModelEffects(internal, parameters, cubism2);
    this.#initialPartOpacities = this.#pose.readParts();
    this.parameters = Array.from(parameters.ids, (id, index) => {
      const info = displayInfo.get(id);
      return {
        id,
        index,
        description: info?.description,
        displayGroup: info?.displayGroup ?? inferDisplayGroup(id),
        motion: groups.motion.has(id) || !groups.expression.has(id),
        expression: groups.expression.has(id),
        min: parameters.minimumValues[index],
        max: parameters.maximumValues[index],
        defaultValue: parameters.defaultValues[index],
      };
    });
    this.#values = Float32Array.from(parameters.values);
    this.#baseValues = this.#values.slice();
    this.#animationValues = new Float32Array(parameters.count);
    this.#blendedValues = new Float32Array(parameters.count);
    this.motions = Object.entries(internal.motionManager.definitions).flatMap(([group, motions]) =>
      motions.map(({ File, file }, index) => {
        const name = (File ?? file).split(/[\\/]/).at(-1).replace(/\.(?:motion3\.json|mtn)$/i, "");
        return { group, index, label: group && group !== name ? `${group} / ${name}` : name };
      })
    );

    this.#expressionManager = internal.motionManager.expressionManager;
    this.expressions = (this.#expressionManager?.definitions ?? []).map(({ Name, name, File, file }) =>
      (Name || name || (File ?? file).split(/[\\/]/).at(-1)).replace(/\.exp(?:3(?:\.json)?|\.json)$/i, "")
    );
    if (this.#expressionManager && cubism2) {
      setupCubism2Expressions(this.#expressionManager, parameters.ids);
    } else if (this.#expressionManager) {
      const create = this.#expressionManager.createExpression.bind(this.#expressionManager);
      // Exedra exports additive offsets as 1 and overwrites as 2.
      this.#expressionManager.createExpression = (data, definition) => create({
        ...data,
        Parameters: (data.Parameters ?? []).map((parameter) => ({
          ...parameter,
          Blend: expressionBlends[parameter.Blend] ?? parameter.Blend,
        })),
      }, definition);
    }

    internal.on("afterMotionUpdate", () => {
      const clip = this.#activeMotion;
      // The adapter clears playing on the update after a motion leaves the queue.
      if (!clip || clip.isLoop() || !internal.motionManager.playing || this.#motionEntry()) return;
      const duration = clip.getLoopDuration();
      if (Number.isFinite(duration) && duration > 0) this.#sampleMotion(clip, duration);
    });

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

  updatePoseGeometry() {
    this.#pose.update();
  }

  advance(deltaMS) {
    if (this.paused) return;
    const fading = this.#advanceExpression(deltaMS);
    if (!this.loadingMotion) this.display.update(deltaMS);
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

  async clone(pixi, onProgress) {
    const values = this.#values.slice();
    const baseValues = this.#baseValues.slice();
    const animationValues = this.#pose.parameters.values.slice();
    const opacities = this.#pose.readParts();
    const { motionChoice, loopMotion, expressionChoice } = this;
    const effects = { ...this.effects.settings };
    const progress = this.motionProgress;
    const copy = await ViewerModel.load(pixi, this.source.clone(), onProgress);
    try {
      copy.motionChoice = motionChoice;
      copy.loopMotion = loopMotion;
      copy.effects.set(effects);
      if (progress) {
        await copy.playMotion();
        const entry = copy.#motionEntry();
        if (entry) copy.#positionMotion(entry, progress.elapsed);
      }
      copy.paused = true;
      await copy.setExpression(expressionChoice, { immediate: true });
      if (copy.expressionError) throw copy.expressionError;
      copy.#values.set(values);
      copy.#baseValues.set(baseValues);
      copy.#pose.parameters.values.set(animationValues);
      copy.#pose.writeParts(opacities);
      copy.#pose.save();
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
    const { values } = this.#pose.parameters;
    this.#animationValues.set(values);
    try {
      values.set(expressionChanged ? this.#baseValues : this.#values);
      if (expressionChanged) {
        // Compose on the held frame so switching expressions never advances a paused motion.
        this.#applyExpression(values);
        this.#values.set(values);
      }
      this.#pose.update();
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
      if (immediate || this.paused) {
        this.#finishExpressionFade();
        this.#applyPose(true);
      } else {
        this.#expressionFade = { layers: new Map(this.#expressionLayers), elapsed: 0 };
      }
    } catch (error) {
      this.expressionError = error;
    } finally {
      this.loadingExpression = false;
    }
  }

  async playMotion(index = this.motionChoice, { resume = true } = {}) {
    if (this.loadingMotion) return;
    if (index === -1) {
      if (this.motionChoice !== -1) this.#clearMotion();
      return;
    }
    const motion = this.motions[index];
    if (!motion) return;
    this.loadingMotion = true;
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
      if (!this.cubism2 && !this.#previewEntry) {
        // The combined adapter keeps its Cubism 4 queue entry class private.
        const Entry = this.#motionEntry().constructor;
        this.#previewEntry = new Entry();
      }
      this.#activeMotion = clip;
      this.#activeMotionIndex = index;
      if (resume) this.paused = false;
      else if (this.paused) this.#previewMotionFrame(0);
    } catch (error) {
      this.motionError = error;
    } finally {
      this.loadingMotion = false;
    }
  }

  #clearMotion() {
    this.display.internalModel.motionManager.stopAllMotions();
    this.motionChoice = this.#activeMotionIndex = -1;
    this.#activeMotion = undefined;
    this.motionError = null;

    const { parameters } = this.#pose;
    parameters.values.set(parameters.defaultValues);
    this.#pose.writeParts(this.#initialPartOpacities);
    this.#pose.save();
    this.#baseValues.set(parameters.values);
    this.#applyPose(true);
  }

  #motionEntry() {
    const manager = this.display.internalModel.motionManager;
    return this.cubism2 ? cubism2MotionEntry(manager) : manager.queueManager._motions[0];
  }

  get motionProgress() {
    const clip = this.#activeMotion;
    if (!clip || this.loadingMotion || this.#activeMotionIndex !== this.motionChoice) return;
    const duration = clip.getLoopDuration();
    const fps = clip._sourceFrameRate;
    const lastFrame = Math.max(1, Math.round(duration * fps));
    if (duration <= 0 || fps <= 0 || !Number.isSafeInteger(lastFrame)) return;

    const entry = this.#motionEntry();
    let elapsed = duration;
    if (entry) {
      const offset = entry.isStarted() ? this.display.elapsedTime / 1000 - entry.getStartTime() : 0;
      elapsed = Math.min(duration, Math.max(0, offset));
    }
    const frame = duration - elapsed < 1e-6 ? lastFrame : Math.min(lastFrame, Math.floor(elapsed * fps + 1e-6));
    return { frame, lastFrame, duration, fps, elapsed };
  }

  async seekMotion(frame) {
    const progress = this.motionProgress;
    if (!progress || !Number.isFinite(frame)) return;
    let entry = this.#motionEntry();
    if (!entry) {
      await this.playMotion(this.motionChoice, { resume: false });
      entry = this.#motionEntry();
      if (!entry || this.motionError) return;
    }
    const target = Math.min(progress.lastFrame, Math.max(0, Math.round(frame)));
    const time = target === progress.lastFrame ? progress.duration : Math.min(progress.duration, target / progress.fps);
    this.paused = true;
    this.#previewMotionFrame(time);
    this.#positionMotion(entry, time);
  }

  #previewMotionFrame(time) {
    this.#sampleMotion(this.#activeMotion, time);
    this.#pose.save();
    this.#baseValues.set(this.#pose.parameters.values);
    this.#applyPose(true);
  }

  #sampleMotion(clip, time) {
    // Preview the authored curves at full weight without advancing the playback queue.
    if (this.cubism2) {
      sampleCubism2Motion(clip, this.#core, time);
      return;
    }
    this.#previewEntry.setStartTime(-time);
    this.#previewEntry.setFadeInStartTime(-Infinity);
    const loop = clip.isLoop();
    clip.setIsLoop(true);
    try {
      clip.doUpdateParameters(this.#core, 0, 1, this.#previewEntry);
    } finally {
      clip.setIsLoop(loop);
    }
  }

  #positionMotion(entry, time) {
    const now = this.display.elapsedTime / 1000;
    entry.setIsStarted?.(true);
    entry.setStartTime(now - time);
    entry.setFadeInStartTime(-Infinity);
    entry.setLastCheckEventSeconds?.(now);
    this.#configureLoop(this.#activeMotion, entry);
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
    this.#configureLoop(this.#activeMotion, this.#motionEntry());
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
