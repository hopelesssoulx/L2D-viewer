function prepareSettings(json, source, live2d) {
  if (!live2d.Cubism4ModelSettings.isValidJSON(json)) {
    throw new Error("模型描述文件缺少有效的 Moc 或 Textures 配置。");
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
    throw new Error("JSON 格式无效。请输入以参数 ID 为键、数值为值的对象。");
  }

  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("请输入 JSON 对象，例如 {\"ParamAngleX\": 10}。");
  }

  const entries = Object.entries(snapshot);
  if (!entries.length) throw new Error("JSON 中没有参数。");

  const byId = new Map(parameters.map((parameter) => [parameter.id, parameter]));
  return entries.map(([id, value]) => {
    const parameter = byId.get(id);
    if (!parameter) throw new Error(`当前模型没有参数 ${id}。`);
    if (!Number.isFinite(value) || value < parameter.min || value > parameter.max) {
      throw new Error(`${id} 必须是 ${parameter.min} 到 ${parameter.max} 之间的数值。`);
    }
    return [parameter.index, value];
  });
}

const expressionBlends = ["Add", "Multiply", "Overwrite"];

export class ViewerModel {
  static async load(pixi, source) {
    const live2d = pixi.live2d;
    const options = { autoUpdate: false, autoInteract: false, motionPreload: "NONE" };
    const display = new live2d.Live2DModel(options);
    let textureURLs = [];
    try {
      const settings = prepareSettings(await source.readSettings(), source, live2d);
      textureURLs = settings.textures.map((reference) => settings.resolveURL(reference));

      // Complete texture requests before the adapter starts decoding the moc.
      const textures = await Promise.allSettled(textureURLs.map((url) => pixi.Texture.fromURL(url)));
      const failedTexture = textures.findIndex((result) => result.status === "rejected");
      if (failedTexture !== -1) {
        throw new Error(`无法读取贴图：${settings.textures[failedTexture]}`);
      }

      const failedOptionals = [];
      display.on("poseLoadError", () => failedOptionals.push(settings.pose));
      display.on("physicsLoadError", () => failedOptionals.push(settings.physics));
      await live2d.Live2DFactory.setupLive2DModel(display, settings, options);
      if (failedOptionals.length) throw new Error(`无法读取模型文件：${failedOptionals.join("、")}`);
      return new ViewerModel(display, source, live2d.MotionPriority.FORCE);
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
  #expressionManager;
  #expression;

  constructor(display, source, motionPriority) {
    this.display = display;
    this.source = source;
    this.name = source.name;
    this.paused = false;
    this.loadingMotion = false;
    this.motionChoice = 0;
    this.motionError = "";
    this.loadingExpression = false;
    this.expressionChoice = -1;
    this.expressionError = "";
    this.#motionPriority = motionPriority;

    const internal = display.internalModel;
    this.#core = internal.coreModel;
    const parameters = this.#core.getModel().parameters;
    this.parameters = Array.from(parameters.ids, (id, index) => ({
      id,
      index,
      min: parameters.minimumValues[index],
      max: parameters.maximumValues[index],
      defaultValue: parameters.defaultValues[index],
    }));
    this.#values = Float32Array.from(parameters.values);
    this.#baseValues = this.#values.slice();
    this.#animationValues = new Float32Array(parameters.count);
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
      this.#expression?.doUpdateParameters(this.#core, 0, 1);
      this.#values.set(parameters.values);
    });
  }

  advance(deltaMS) {
    if (!this.paused && !this.loadingMotion) this.display.update(deltaMS);
  }

  async clone(pixi) {
    const values = this.#values.slice();
    const baseValues = this.#baseValues.slice();
    const opacities = this.#core.getModel().parts.opacities.slice();
    const { motionChoice, expressionChoice } = this;
    const copy = await ViewerModel.load(pixi, this.source.clone());
    try {
      copy.paused = true;
      await copy.setExpression(expressionChoice);
      if (copy.expressionError) throw new Error(copy.expressionError);
      copy.motionChoice = motionChoice;
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

  resetParameters() {
    this.paused = true;
    for (const parameter of this.parameters) this.#values[parameter.index] = parameter.defaultValue;
    this.#baseValues.set(this.#values);
    this.#applyPose();
  }

  exportParameters() {
    return JSON.stringify(Object.fromEntries(
      this.parameters.map(({ id, index }) => [id, this.#values[index]])
    ), null, 2);
  }

  importParameters(text) {
    const entries = readSnapshot(text, this.parameters);
    this.paused = true;
    for (const [index, value] of entries) this.#baseValues[index] = this.#values[index] = value;
    this.#applyPose();
    return entries.length;
  }

  #applyPose(expressionChanged = false) {
    const values = this.#core.getModel().parameters.values;
    this.#animationValues.set(values);
    try {
      values.set(expressionChanged ? this.#baseValues : this.#values);
      if (expressionChanged) {
        // Compose on the held frame so switching expressions never advances a paused motion.
        this.#expression?.doUpdateParameters(this.#core, 0, 1);
        this.#values.set(values);
      }
      this.#core.update();
    } finally {
      // Keep the playback baseline and clock intact while editing a still frame.
      values.set(this.#animationValues);
    }
  }

  async setExpression(index) {
    if (this.loadingExpression || index === this.expressionChoice) return;
    this.loadingExpression = true;
    this.expressionError = "";
    try {
      const expression = index < 0 ? undefined : await this.#expressionManager.loadExpression(index);
      if (index >= 0 && !expression) throw new Error("无法加载所选表情。");
      this.#expression = expression;
      this.expressionChoice = index;
      if (this.paused) this.#applyPose(true);
    } catch (error) {
      this.expressionError = error.message;
    } finally {
      this.loadingExpression = false;
    }
  }

  async playMotion() {
    const motion = this.motions[this.motionChoice];
    if (!motion || this.loadingMotion) return;
    this.loadingMotion = true;
    this.motionError = "";
    try {
      this.display.internalModel.motionManager.stopAllMotions();
      const started = await this.display.motion(motion.group, motion.index, this.#motionPriority);
      if (!started) throw new Error("无法加载或播放所选动作。");
      this.paused = false;
    } catch (error) {
      this.motionError = error.message;
    } finally {
      this.loadingMotion = false;
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
