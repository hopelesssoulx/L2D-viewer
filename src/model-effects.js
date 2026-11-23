const defaults = {
  headSwayStrength: 100,
  physics: true,
  physicsStrength: 100,
  breathing: true,
  breathStrength: 100,
  eyeBlink: true,
  blinkInterval: 4,
  gazeFollow: false,
};

function clampParameter(parameters, index, value) {
  return Math.max(parameters.minimumValues[index], Math.min(parameters.maximumValues[index], value));
}

function setupNaturalMovements(internal, parameters, swayIndices, breathIndex, settings) {
  const update = internal.updateNaturalMovements.bind(internal);
  const beforeSway = new Float32Array(swayIndices.length);
  internal.updateNaturalMovements = (delta, now) => {
    const swayWeight = settings.headSwayStrength / 100;
    const breathWeight = settings.breathing ? settings.breathStrength / 100 : 0;
    const values = parameters.values;
    const beforeBreath = values[breathIndex];
    if (swayWeight !== 1) {
      for (const [slot, index] of swayIndices.entries()) beforeSway[slot] = values[index];
    }
    update(delta, now);
    if (swayWeight !== 1) {
      for (const [slot, index] of swayIndices.entries()) {
        const before = beforeSway[slot];
        const value = before + (values[index] - before) * swayWeight;
        values[index] = clampParameter(parameters, index, value);
      }
    }
    if (breathIndex >= 0 && breathWeight !== 1) {
      const value = beforeBreath + (values[breathIndex] - beforeBreath) * breathWeight;
      values[breathIndex] = clampParameter(parameters, breathIndex, value);
    }
  };
}

function setupPhysics(internal, parameters, cubism2, settings) {
  const physics = internal.physics;
  const method = cubism2 ? "update" : "evaluate";
  const update = physics[method].bind(physics);
  const before = new Float32Array(parameters.count);
  physics[method] = (...args) => {
    const weight = settings.physics ? settings.physicsStrength / 100 : 0;
    if (weight !== 1) before.set(parameters.values);
    update(...args);
    if (weight === 1) return;

    // Preserve the solver's state and blend only its parameter output.
    const { values } = parameters;
    if (weight === 0) {
      values.set(before);
      return;
    }
    for (let index = 0; index < values.length; index++) {
      if (values[index] === before[index]) continue;
      const value = before[index] + (values[index] - before[index]) * weight;
      values[index] = clampParameter(parameters, index, value);
    }
  };
}

function fixLegacyBlink(blink) {
  const update = blink.update.bind(blink);
  blink.update = (deltaMS) => {
    // The Cubism 2 adapter adds to the eye-opening value during the closing phase.
    if (blink.eyeState === 1) {
      blink.setEyeParams(blink.eyeParamValue - deltaMS / blink.closingDuration);
      if (blink.eyeParamValue <= 0) {
        blink.eyeState = 2;
        blink.closedTimer = 0;
      }
      return;
    }
    if (blink.eyeState === 2) blink.setEyeParams(0);
    update(deltaMS);
  };
}

function setBlinkInterval(blink, cubism2, interval) {
  if (cubism2) {
    blink.blinkInterval = interval * 1000;
    blink.nextBlinkTimeLeft = blink.blinkInterval;
  } else {
    blink.setBlinkingInterval(interval);
    blink._nextBlinkingTime = blink.determinNextBlinkingTiming();
  }
}

export function setupModelEffects(internal, parameters, cubism2) {
  const settings = { ...defaults };
  const ids = [...parameters.ids];
  const swayNames = cubism2
    ? ["PARAM_ANGLE_X", "PARAM_ANGLE_Y", "PARAM_ANGLE_Z", "PARAM_BODY_ANGLE_X"]
    : [internal.idParamAngleX, internal.idParamAngleY, internal.idParamAngleZ, internal.idParamBodyAngleX];
  const swayIndices = swayNames.map((id) => ids.indexOf(id)).filter((index) => index >= 0);
  const breathIndex = ids.indexOf(cubism2 ? "PARAM_BREATH" : internal.idParamBreath);
  const eyeX = ids.indexOf(cubism2 ? "PARAM_EYE_BALL_X" : internal.idParamEyeBallX);
  const eyeY = ids.indexOf(cubism2 ? "PARAM_EYE_BALL_Y" : internal.idParamEyeBallY);
  const blink = internal.eyeBlink;
  const blinkIds = cubism2 ? ["PARAM_EYE_L_OPEN", "PARAM_EYE_R_OPEN"] : blink?.getParameterIds() ?? [];
  const supported = {
    headSwayStrength: swayIndices.length > 0,
    physics: Boolean(internal.physics),
    breathing: breathIndex >= 0,
    eyeBlink: Boolean(blink && blinkIds.some((id) => ids.includes(id))),
    gazeFollow: eyeX >= 0 || eyeY >= 0,
  };

  setupNaturalMovements(internal, parameters, swayIndices, breathIndex, settings);
  if (supported.physics) setupPhysics(internal, parameters, cubism2, settings);
  if (supported.eyeBlink && cubism2) fixLegacyBlink(blink);
  if (!supported.eyeBlink) internal.eyeBlink = undefined;

  internal.updateFocus = () => {
    if (!settings.gazeFollow) return;
    const { x, y } = internal.focusController;
    const { values } = parameters;
    if (eyeX >= 0) values[eyeX] = clampParameter(parameters, eyeX, values[eyeX] + x);
    if (eyeY >= 0) values[eyeY] = clampParameter(parameters, eyeY, values[eyeY] + y);
  };

  function set(changes) {
    const oldInterval = settings.blinkInterval;
    Object.assign(settings, changes);
    if (supported.eyeBlink) {
      if (settings.blinkInterval !== oldInterval) setBlinkInterval(blink, cubism2, settings.blinkInterval);
      internal.eyeBlink = settings.eyeBlink ? blink : undefined;
    }
    if (changes.gazeFollow === false) internal.focusController.focus(0, 0, true);
  }

  function reset(effect) {
    set({ [effect]: defaults[effect] });
  }

  return { settings, supported, set, reset };
}
