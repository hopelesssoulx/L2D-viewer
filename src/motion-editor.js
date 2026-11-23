import { t } from "./i18n.js";
import { changeDuration, decodeMotion, deleteKey, encodeMotion, findCurve, moveKey, newMotion, parameterTarget, writeKey } from "./motion-draft.js";
import { setupMotionGraph } from "./motion-graph.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const format = (value) => String(Number(value.toFixed(5)));
const frameCount = ({ Duration, Fps }) => Math.max(1, Math.round(Duration * Fps));
function timeAtFrame(frame, meta) {
  const last = frameCount(meta);
  const index = clamp(Math.round(frame), 0, last);
  return index === last ? meta.Duration : Math.min(meta.Duration, index / meta.Fps);
}

export function motionOptionLabel(motion) {
  return motion.data ? t("editorTemporary", { name: motion.label }) : motion.label;
}

export function setupMotionEditor(panel, onChange, onSave) {
  const controls = Object.fromEntries([...panel.querySelectorAll("*")].flatMap((element) =>
    Object.keys(element.dataset).filter((key) => /^editor[A-Z]/.test(key))
      .map((key) => [key[6].toLowerCase() + key.slice(7), element])));
  const drafts = new WeakMap();
  let state;
  let nextFrame;
  let sourceRequest = 0;
  let expressionRequest = 0;

  function message(key, args, error = false) {
    state.message = { key, args, error };
    controls.status.textContent = key ? t(key, args) : "";
    controls.status.classList.toggle("error", error);
  }

  function refreshOptions() {
    const model = state.model;
    controls.model.textContent = model.name;
    controls.source.replaceChildren(new Option(t("editorNew"), -1),
      ...model.motions.map((motion, index) => new Option(motionOptionLabel(motion), index)));
    controls.source.value = state.source;
    controls.expression.replaceChildren(new Option(t("noExpression"), -1),
      ...model.expressions.map((name, index) => new Option(name, index)));
    controls.expression.value = state.expressionIndex;
    refreshTracks();
  }

  function refreshTracks() {
    const tracks = new Set(state.draft?.Curves.filter(({ Target }) => Target === parameterTarget).map(({ Id }) => Id));
    const available = state.model.parameters;
    const used = document.createElement("optgroup");
    const other = document.createElement("optgroup");
    used.label = t("editorTracks");
    other.label = t("editorOtherParameters");
    for (const parameter of available) {
      (tracks.has(parameter.id) ? used : other).append(new Option(parameter.id, parameter.id));
    }
    controls.parameter.replaceChildren(...[used, other].filter((group) => group.children.length));
    if (!available.some(({ id }) => id === state.parameterId)) {
      state.parameterId = used.firstElementChild?.value ?? available[0]?.id;
    }
    controls.parameter.value = state.parameterId ?? "";
  }

  function currentTrack() {
    return findCurve(state.draft, state.parameterId);
  }

  function render() {
    const { draft, model, loading, expressionLoading } = state;
    const ready = Boolean(draft && !loading && !expressionLoading);
    for (const control of ["name", "duration", "fps", "parameter", "value", "key", "delete",
      "expression", "bake", "play", "time", "frame", "export", "save"]) {
      controls[control].disabled = !ready;
    }
    if (!ready) return;

    let changes = [];
    try {
      if (!state.compiled && draft.Curves.length) state.compiled = model.compileDraftMotion(encodeMotion(draft));
      changes = model.previewDraftFrame(state.compiled, state.time, state.expression);
    } catch {
      message("editorFailed", undefined, true);
      controls.export.disabled = controls.save.disabled = controls.play.disabled = true;
    }
    state.expressionChanges = changes;
    const parameter = model.parameters.find(({ id }) => id === state.parameterId);
    const track = currentTrack();
    const key = track?.keys.findIndex(({ time }) => Math.abs(time - state.time) < 1e-7) ?? -1;
    const { Duration, Fps, AreBeziersRestricted } = draft.Meta;
    const last = frameCount(draft.Meta);
    const frame = clamp(Math.round(state.time * Fps), 0, last);
    controls.graph.dataset.parameter = parameter?.id ?? "";
    controls.duration.value = format(Duration);
    controls.fps.value = format(Fps);
    controls.time.max = controls.frame.max = String(last);
    controls.time.value = controls.frame.value = String(frame);
    controls.timeLabel.textContent = `${format(state.time)} s · ${frame} / ${last}`;
    controls.play.textContent = t(nextFrame === undefined ? "editorPlay" : "pause");
    controls.value.disabled = controls.key.disabled = !parameter;
    if (parameter) {
      controls.value.min = parameter.min;
      controls.value.max = parameter.max;
      const value = key >= 0 ? track.keys[key].value : model.valueAt(parameter.index);
      controls.value.value = format(value);
    }
    controls.delete.disabled = key < 0;
    controls.bake.disabled = changes.length === 0;
    controls.export.disabled ||= draft.Curves.length === 0;
    controls.save.disabled ||= draft.Curves.length === 0 || state.saved;
    drawGraph({
      keys: track?.keys ?? [], parameter, time: state.time, duration: Duration,
      selectedKey: key, restricted: AreBeziersRestricted,
    });
  }

  function stop() {
    cancelAnimationFrame(nextFrame);
    nextFrame = undefined;
  }

  function seekFrame(frame) {
    if (!state?.draft || controls.time.disabled || !Number.isFinite(frame)) return;
    stop();
    state.time = timeAtFrame(frame, state.draft.Meta);
    render();
  }

  function markEdited() {
    state.compiled = undefined;
    state.dirty = true;
    state.saved = false;
    message();
  }

  const drawGraph = setupMotionGraph(controls.graph, {
    seek: (time) => {
      if (state?.draft) seekFrame(time * state.draft.Meta.Fps);
    },
    selectKey: (index) => {
      if (controls.time.disabled) return;
      stop();
      state.time = currentTrack().keys[index].time;
      render();
    },
    moveKey: (index, time, value) => {
      if (controls.time.disabled) return;
      const { Meta } = state.draft;
      const parameter = state.model.parameters.find(({ id }) => id === state.parameterId);
      const track = currentTrack();
      const snapped = timeAtFrame(time * Meta.Fps, Meta);
      moveKey(track, index, snapped, clamp(value, parameter.min, parameter.max));
      state.time = track.keys[index].time;
      markEdited();
      render();
    },
  });

  async function loadSource(index, fromPose = false, time = 0) {
    const active = state;
    if (active.dirty && !confirm(t("editorReplace"))) {
      controls.source.value = active.source;
      return;
    }
    stop();
    const ticket = ++sourceRequest;
    active.loading = true;
    message("editorLoading");
    render();
    try {
      const { model } = active;
      const draft = index >= 0 ? decodeMotion(await model.readMotionData(index))
        : newMotion(model.parameters, fromPose ? model.parameters.map(({ index }) => model.valueAt(index)) : []);
      if (state !== active || ticket !== sourceRequest) return;
      Object.assign(active, {
        draft, source: index, name: index >= 0 ? model.motions[index].label : "", parameterId: undefined,
        time: clamp(time, 0, draft.Meta.Duration), compiled: undefined, dirty: false, saved: false,
      });
      if (fromPose) {
        expressionRequest++;
        active.expressionLoading = false;
        active.expression = undefined;
        active.expressionIndex = -1;
      }
      controls.name.value = active.name;
      message(index >= 0 ? "editorLoaded" : undefined);
    } catch (error) {
      if (state === active && ticket === sourceRequest) {
        message(error instanceof Error && error.key === "motionEditorInvalid" ? error.key : "editorLoadFailed", undefined, true);
      }
    } finally {
      if (state === active && ticket === sourceRequest) {
        active.loading = false;
        refreshOptions();
        render();
      }
    }
  }

  controls.source.addEventListener("change", () => void loadSource(Number(controls.source.value)));
  controls.new.addEventListener("click", () => void loadSource(-1));
  controls.current.addEventListener("click", () => void loadSource(-1, true));
  controls.name.addEventListener("input", () => {
    state.name = controls.name.value;
    state.saved = false;
    state.dirty = true;
    controls.save.disabled = !state.draft.Curves.length;
  });
  for (const [control, field] of [["duration", "Duration"], ["fps", "Fps"]]) {
    controls[control].addEventListener("change", () => {
      stop();
      const input = controls[control];
      const value = input.valueAsNumber;
      const { Meta } = state.draft;
      const other = field === "Duration" ? Meta.Fps : Meta.Duration;
      if (value > 0 && input.checkValidity() && Number.isSafeInteger(Math.round(value * other))) {
        if (field === "Duration") {
          state.time *= value / Meta.Duration;
          changeDuration(state.draft, value);
        } else {
          Meta.Fps = value;
        }
        markEdited();
      }
      render();
    });
  }
  controls.parameter.addEventListener("change", () => {
    state.parameterId = controls.parameter.value;
    render();
  });
  for (const [control, event] of [["time", "input"], ["frame", "change"]]) {
    controls[control].addEventListener(event, () => seekFrame(controls[control].valueAsNumber));
  }
  for (const control of ["value", "duration", "fps", "frame"]) {
    controls[control].addEventListener("focus", () => {
      if (nextFrame !== undefined) {
        stop();
        render();
      }
    });
  }
  controls.value.addEventListener("keydown", (event) => {
    if (event.key === "Enter") controls.key.click();
  });
  controls.key.addEventListener("click", () => {
    stop();
    const parameter = state.model.parameters.find(({ id }) => id === state.parameterId);
    const value = controls.value.valueAsNumber;
    if (!Number.isFinite(value)) return;
    writeKey(state.draft, parameter.id, state.time, clamp(value, parameter.min, parameter.max), parameter.defaultValue);
    markEdited();
    refreshTracks();
    render();
  });
  controls.delete.addEventListener("click", () => {
    stop();
    const track = currentTrack();
    deleteKey(state.draft, track, track.keys.findIndex(({ time }) => Math.abs(time - state.time) < 1e-7));
    markEdited();
    refreshTracks();
    render();
  });
  controls.expression.addEventListener("change", async () => {
    stop();
    const active = state;
    const index = Number(controls.expression.value);
    const ticket = ++expressionRequest;
    active.expressionLoading = true;
    render();
    try {
      const expression = await active.model.loadDraftExpression(index);
      if (state !== active || ticket !== expressionRequest) return;
      active.expressionIndex = index;
      active.expression = expression;
      message();
    } catch {
      if (state === active && ticket === expressionRequest) message("expressionFailed", undefined, true);
    } finally {
      if (state === active && ticket === expressionRequest) {
        active.expressionLoading = false;
        controls.expression.value = active.expressionIndex;
        render();
      }
    }
  });
  controls.bake.addEventListener("click", () => {
    stop();
    const changes = state.expressionChanges;
    for (const { parameter, value } of changes) {
      writeKey(state.draft, parameter.id, state.time, value, parameter.defaultValue);
    }
    state.expression = undefined;
    state.expressionIndex = -1;
    controls.expression.value = "-1";
    markEdited();
    message("editorBaked", { count: changes.length });
    refreshTracks();
    render();
  });
  controls.play.addEventListener("click", () => {
    if (nextFrame !== undefined) {
      stop();
      render();
      return;
    }
    const duration = state.draft.Meta.Duration;
    if (state.time >= duration) state.time = 0;
    const start = performance.now() - state.time * 1000;
    const advance = (now) => {
      state.time = Math.min(duration, Math.max(0, (now - start) / 1000));
      nextFrame = state.time < duration ? requestAnimationFrame(advance) : undefined;
      render();
    };
    nextFrame = requestAnimationFrame(advance);
    render();
  });

  const name = () => state.name.trim() || t("editorNew");
  controls.save.addEventListener("click", () => {
    stop();
    try {
      state.model.addCustomMotion(name(), encodeMotion(state.draft));
      state.dirty = false;
      state.saved = true;
      refreshOptions();
      message("editorSaved");
      onSave();
    } catch {
      message("editorFailed", undefined, true);
    }
    render();
  });
  controls.export.addEventListener("click", () => {
    try {
      const data = JSON.stringify(encodeMotion(state.draft), null, 2);
      const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name().replace(/[<>:"/\\|?*]/g, "_") + ".motion3.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      state.dirty = false;
      message("editorExported");
    } catch {
      message("editorFailed", undefined, true);
    }
  });

  function close() {
    if (!state) return;
    stop();
    sourceRequest++;
    expressionRequest++;
    state.loading = state.expressionLoading = false;
    state.model.endDraftPreview();
    state = undefined;
    panel.hidden = true;
    onChange();
  }

  function open(model) {
    if (state?.model === model) return;
    close();
    state = drafts.get(model) ?? { model, source: -1, expressionIndex: -1, time: 0, name: "" };
    drafts.set(model, state);
    const progress = model.motionProgress;
    const fromPose = model.motionChoice < 0 && model.paused;
    model.beginDraftPreview();
    panel.hidden = false;
    controls.name.value = state.name;
    refreshOptions();
    onChange();
    if (state.draft) render();
    else void loadSource(model.motionChoice, fromPose, progress?.elapsed ?? 0);
  }

  function localize() {
    if (!state) return;
    if (!state.loading && !state.expressionLoading) refreshOptions();
    const { key, args, error } = state.message ?? {};
    message(key, args, error);
    render();
  }

  return { open, close, localize };
}
