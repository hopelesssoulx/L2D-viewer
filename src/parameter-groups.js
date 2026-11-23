async function collectByFile(settings, definitions, read) {
  const byFile = new Map();
  const files = new Set(definitions.map(({ File, file }) => File ?? file));
  await Promise.all([...files].map(async (file) => {
    try {
      const response = await fetch(settings.resolveURL(file));
      if (response.ok) byFile.set(file, await read(response));
    } catch {
      // A malformed clip is reported if the user tries to play it.
    }
  }));
  return byFile;
}

function valueRange(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return min <= max ? [min, max] : undefined;
}

function* bezierExtrema(start, first, second, end) {
  // The derivative is a quadratic. Its roots inside the segment give the extrema.
  const a = -start + 3 * first - 3 * second + end;
  const b = 2 * (start - 2 * first + second);
  const c = first - start;
  const discriminant = b * b - 4 * a * c;
  const roots = a === 0 ? [-c / b]
    : discriminant < 0 ? []
    : [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)];
  for (const t of roots) {
    if (!(t > 0 && t < 1)) continue;
    const u = 1 - t;
    yield u ** 3 * start + 3 * u ** 2 * t * first + 3 * u * t ** 2 * second + t ** 3 * end;
  }
}

function* motion3Values(segments) {
  let previous = segments[1];
  yield previous;
  for (let index = 2; index < segments.length;) {
    const isBezier = segments[index] === 1;
    const end = index + (isBezier ? 6 : 2);
    const value = segments[end];
    if (isBezier) yield* bezierExtrema(previous, segments[index + 2], segments[index + 4], value);
    yield value;
    previous = value;
    index = end + 1;
  }
}

export function motion3Tracks(curves, { eyeBlinkIds, lipSyncIds }) {
  const tracks = new Map();
  const effects = new Map();
  for (const curve of curves) {
    if (typeof curve?.Id !== "string") continue;
    if (curve.Target === "Parameter") tracks.set(curve.Id, valueRange(motion3Values(curve.Segments ?? [])));
    if (curve.Target === "Model") effects.set(curve.Id, valueRange(motion3Values(curve.Segments ?? [])));
  }

  const blink = effects.get("EyeBlink");
  const lips = effects.get("LipSync");
  const affected = new Set([...(blink ? eyeBlinkIds : []), ...(lips ? lipSyncIds : [])]);
  for (const id of affected) {
    const eye = eyeBlinkIds.includes(id) ? blink : undefined;
    const lip = lipSyncIds.includes(id) ? lips : undefined;
    let range = tracks.get(id);
    // With no direct parameter curve, the model curve supplies the absolute value.
    if (!range) {
      tracks.set(id, lip ?? eye);
      continue;
    }
    if (eye) {
      range = valueRange([range[0] * eye[0], range[0] * eye[1], range[1] * eye[0], range[1] * eye[1]]);
    }
    if (lip) range = [range[0] + lip[0], range[1] + lip[1]];
    tracks.set(id, range);
  }
  return tracks;
}

export async function readParameterGroups(settings, cubism2) {
  const effects = cubism2 ? null : {
    eyeBlinkIds: settings.getEyeBlinkParameters() ?? [],
    lipSyncIds: settings.getLipSyncParameters() ?? [],
  };
  const [motionTracks, expressionIds] = await Promise.all([
    collectByFile(settings, Object.values(settings.motions ?? {}).flat(), async (response) => {
      if (cubism2) {
        const text = await response.text();
        const tracks = text.matchAll(/^([^#=$\s][^=\r\n]*)=([^\r\n]*)/gm);
        return new Map(Array.from(tracks, ([, id, samples]) =>
          [id.trim(), valueRange(samples.split(",").map((sample) => Number.parseFloat(sample)))]
        ));
      }
      const { Curves = [] } = await response.json();
      return motion3Tracks(Curves, effects);
    }),
    collectByFile(settings, settings.expressions ?? [], async (response) => {
      const { Parameters, params } = await response.json();
      return (Parameters ?? params ?? []).map((parameter) => parameter?.Id ?? parameter?.id);
    }),
  ]);
  return {
    motionTracks,
    motion: new Set([...motionTracks.values()].flatMap((tracks) => [...tracks.keys()])),
    expression: new Set([...expressionIds.values()].flat().filter((id) => typeof id === "string")),
  };
}

export function changedMotionParameterIds(tracks, parameters) {
  // Match the clamping and Float32 precision of the actual parameter values.
  return new Set(parameters.filter(({ id, min, max, defaultValue }) =>
    tracks?.get(id)?.some((value) => Math.fround(Math.min(max, Math.max(min, value))) !== defaultValue)
  ).map(({ id }) => id));
}
