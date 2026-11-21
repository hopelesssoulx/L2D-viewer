// The pinned Cubism 2 core uses negative start times for uninitialized queue entries.
const clockOffset = 1_000_000_000;

// This core exposes its pose and queue data through obfuscated fields.
export function createCubism2Pose(internal) {
  const core = internal.coreModel;
  const context = core.getModelContext();
  const count = context._$qo;
  const partCount = context._$F2.length;
  const parameters = {
    ids: context._$pb.slice(0, count).map(({ id }) => id),
    count,
    minimumValues: context._$Rr.slice(0, count),
    maximumValues: context._$Or.slice(0, count),
    defaultValues: context._$_2.slice(0, count),
    get values() { return context._$_2.subarray(0, count); },
  };

  let needsMasks = false;
  const draw = internal.draw.bind(internal);
  internal.draw = (gl) => {
    if (needsMasks) {
      context.preDraw(core.drawParamWebGL);
      needsMasks = false;
    }
    draw(gl);
  };

  return {
    parameters,
    readParts: () => Float32Array.from({ length: partCount }, (_, index) => core.getPartsOpacity(index)),
    writeParts: (values) => values.forEach((value, index) => core.setPartsOpacity(index, value)),
    save: () => core.saveParam(),
    update() {
      context.update();
      // Mask generation requires the renderer's active WebGL context.
      needsMasks = true;
    },
  };
}

export function setupCubism2Motions(manager) {
  const create = manager.createMotion.bind(manager);
  manager.createMotion = (data, group, definition) => {
    const clip = create(data, group, definition);
    clip.getLoopDuration = () => clip.getLoopDurationMSec() / 1000;
    clip.isLoop = () => clip._$E;
    clip.setIsLoop = (loop) => { clip._$E = loop; };
    clip._sourceFrameRate = clip._$D0;
    return clip;
  };

  const update = manager.updateParameters.bind(manager);
  manager.updateParameters = (core, now) => {
    const clock = globalThis.UtSystem;
    const previous = clock._$CS;
    // Use this model's playback time so pausing and seeking work independently.
    clock.setUserTimeMSec(clockOffset + now);
    try {
      return update(core, now);
    } finally {
      clock.setUserTimeMSec(previous);
    }
  };
}

export function cubism2MotionEntry(manager) {
  const entry = manager.queueManager.motions[0];
  if (!entry) return;
  return {
    isStarted: () => entry._$z2 >= 0,
    getStartTime: () => (entry._$z2 - clockOffset) / 1000,
    setStartTime: (seconds) => { entry._$z2 = clockOffset + seconds * 1000; },
    setFadeInStartTime: (seconds) => { entry._$bs = clockOffset + seconds * 1000; },
    setEndTime: (seconds) => { entry._$Do = seconds < 0 ? -1 : clockOffset + seconds * 1000; },
  };
}

export function sampleCubism2Motion(clip, core, seconds) {
  clip.updateParamExe(core, seconds * 1000, 1, { _$z2: 0 });
}

export function setupCubism2Expressions(manager, ids) {
  const indices = new Map(ids.map((id, index) => [id, index]));
  const create = manager.createExpression.bind(manager);
  manager.createExpression = (data, definition) => {
    const expression = create(data, definition);
    const parameters = expression.params.filter(({ id }) => indices.has(id));
    expression.doUpdateParameters = (core) => {
      for (const { calc, id, val } of parameters) {
        const index = indices.get(id);
        if (calc === "mult") core.multParamFloat(index, val);
        else if (calc === "set") core.setParamFloat(index, val);
        else core.addToParamFloat(index, val);
      }
    };
    return expression;
  };
}

export function* visibleCubism2Drawables(core) {
  const context = core.getModelContext();
  for (const [index, drawable] of context._$8b.entries()) {
    if (!drawable?._$yo()) continue;
    const opacity = context.getDrawData(index).getOpacity(context, drawable);
    if (opacity * drawable.baseOpacity * core.getPartsOpacity(drawable._$IP) > 0.01) yield index;
  }
}
