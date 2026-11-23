import { ViewerError } from "./i18n.js";

export const parameterTarget = "Parameter";

export function decodeMotion(data) {
  const { Meta, Curves } = data ?? {};
  if (!Number.isFinite(Meta?.Duration) || !Number.isFinite(Meta?.Fps) || !(Meta.Duration > 0 && Meta.Fps > 0)
    || !Number.isSafeInteger(Math.round(Meta.Duration * Meta.Fps)) || !Array.isArray(Curves)) {
    throw new ViewerError("motionEditorInvalid");
  }
  return {
    ...data,
    Meta: { ...Meta },
    Curves: Curves.map(({ Segments, ...curve }) => {
      if (!Array.isArray(Segments) || Segments.length < 2 || !Segments.every(Number.isFinite)) {
        throw new ViewerError("motionEditorInvalid");
      }
      const keys = [{ time: Segments[0], value: Segments[1] }];
      for (let offset = 2; offset < Segments.length;) {
        const type = Segments[offset];
        const end = offset + (type === 1 ? 6 : 2);
        if (![0, 1, 2, 3].includes(type) || end >= Segments.length || Segments[end - 1] < keys.at(-1).time) {
          throw new ViewerError("motionEditorInvalid");
        }
        const key = { time: Segments[end - 1], value: Segments[end], type };
        if (type === 1) key.handles = Segments.slice(offset + 1, end - 1);
        keys.push(key);
        offset = end + 1;
      }
      return { ...curve, keys };
    }),
  };
}

export function newMotion(parameters, values = []) {
  const draft = {
    Version: 3,
    Meta: { Duration: 1, Fps: 30, Loop: false, FadeInTime: 0, FadeOutTime: 0, AreBeziersRestricted: false },
    Curves: [],
  };
  for (const { id, index, defaultValue } of parameters) {
    const value = values[index];
    if (Number.isFinite(value) && value !== defaultValue) writeKey(draft, id, 0, value);
  }
  return draft;
}

export function encodeMotion(draft) {
  let segmentCount = 0;
  let pointCount = 0;
  const Curves = draft.Curves.map(({ keys, ...curve }) => {
    const [first] = keys;
    const Segments = [first.time, first.value];
    pointCount++;
    // A constant track still needs a segment in the Web runtime.
    const tail = keys.length > 1 ? keys.slice(1)
      : [{ time: draft.Meta.Duration, value: first.value, type: 0 }];
    for (const { time, value, type, handles } of tail) {
      Segments.push(type, ...(handles ?? []), time, value);
      segmentCount++;
      pointCount += type === 1 ? 3 : 1;
    }
    return { ...curve, Segments };
  });
  const events = draft.UserData ?? [];
  return {
    ...draft,
    Curves,
    Meta: {
      ...draft.Meta,
      CurveCount: Curves.length,
      TotalSegmentCount: segmentCount,
      TotalPointCount: pointCount,
      UserDataCount: events.length,
      TotalUserDataSize: new TextEncoder().encode(events.map(({ Value }) => Value).join("")).length,
    },
  };
}

export function findCurve(draft, id) {
  return draft.Curves.find((curve) => curve.Target === parameterTarget && curve.Id === id);
}

function retimeHandles(key, previous, from, to) {
  if (!key.handles) return;
  const [first, v1, second, v2] = key.handles;
  const start = previous.time;
  const span = key.time - start;
  const shift = (time, ratio) => span ? from + (to - from) * (time - start) / span : from + (to - from) * ratio;
  key.handles = [shift(first, 1 / 3), v1, shift(second, 2 / 3), v2];
}

export function writeKey(draft, id, time, value, initialValue = value) {
  let curve = findCurve(draft, id);
  if (!curve) {
    curve = { Target: parameterTarget, Id: id, keys: [{ time: 0, value: initialValue }] };
    // The SDK reads model curves, parameter curves, then part curves in that order.
    const partIndex = draft.Curves.findIndex(({ Target }) => Target === "PartOpacity");
    draft.Curves.splice(partIndex < 0 ? draft.Curves.length : partIndex, 0, curve);
  }
  const { keys } = curve;
  const index = keys.findIndex((key) => key.time >= time - 1e-7);
  const next = keys[index];
  if (next && Math.abs(next.time - time) < 1e-7) {
    next.value = value;
    return index;
  }
  if (index < 0) return keys.push({ time, value, type: 0 }) - 1;
  if (index > 0) retimeHandles(next, keys[index - 1], time, next.time);
  else {
    next.type = 0;
    delete next.handles;
  }
  keys.splice(index, 0, { time, value, type: index ? 0 : undefined });
  return index;
}

export function moveKey(curve, index, time, value) {
  const { keys } = curve;
  const key = keys[index];
  const previous = keys[index - 1];
  const next = keys[index + 1];
  // Preserve the starting key and keep adjacent keys in time order.
  const canMove = Boolean(previous || key.time !== 0)
    && (!previous || time > previous.time) && (!next || time < next.time);
  const target = canMove ? time : key.time;
  if (target !== key.time) {
    if (previous) retimeHandles(key, previous, previous.time, target);
    if (next) retimeHandles(next, key, target, next.time);
  }
  key.time = target;
  key.value = value;
}

export function deleteKey(draft, curve, index) {
  const { keys } = curve;
  const previous = keys[index - 1];
  const next = keys[index + 1];
  if (previous && next) retimeHandles(next, keys[index], previous.time, next.time);
  keys.splice(index, 1);
  if (!keys.length) {
    draft.Curves.splice(draft.Curves.indexOf(curve), 1);
  } else if (!index) {
    if (keys[1]) retimeHandles(keys[1], keys[0], 0, keys[1].time);
    keys[0].time = 0;
    delete keys[0].type;
    delete keys[0].handles;
  }
}

export function changeDuration(draft, duration) {
  const scale = duration / draft.Meta.Duration;
  for (const { keys } of draft.Curves) {
    for (const key of keys) {
      key.time *= scale;
      if (key.handles) {
        key.handles[0] *= scale;
        key.handles[2] *= scale;
      }
    }
  }
  if (draft.UserData) draft.UserData = draft.UserData.map((event) => ({ ...event, Time: event.Time * scale }));
  draft.Meta.Duration = duration;
}
