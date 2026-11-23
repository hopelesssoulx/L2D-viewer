async function collectIds(settings, definitions, readIds) {
  const all = new Set();
  const byFile = new Map();
  const files = new Set(definitions.map(({ File, file }) => File ?? file));
  await Promise.all([...files].map(async (file) => {
    try {
      const response = await fetch(settings.resolveURL(file));
      if (!response.ok) return;
      const ids = new Set();
      for (const id of await readIds(response)) {
        if (typeof id !== "string") continue;
        ids.add(id);
        all.add(id);
      }
      byFile.set(file, ids);
    } catch {
      // A malformed clip is reported if the user tries to play it.
    }
  }));
  return { all, byFile };
}

export async function readParameterGroups(settings, cubism2) {
  const motionEffects = cubism2 ? null : new Map([
    ["EyeBlink", settings.getEyeBlinkParameters() ?? []],
    ["LipSync", settings.getLipSyncParameters() ?? []],
  ]);
  const [motion, expression] = await Promise.all([
    collectIds(settings, Object.values(settings.motions ?? {}).flat(), async (response) => {
      if (cubism2) {
        const text = await response.text();
        return Array.from(text.matchAll(/^([^#=$\s][^=\r\n]*)=/gm), ([, id]) => id.trim());
      }
      const { Curves = [] } = await response.json();
      return Curves.flatMap((curve) => {
        if (curve?.Target === "Parameter") return [curve.Id];
        if (curve?.Target === "Model") return motionEffects.get(curve.Id) ?? [];
        return [];
      });
    }),
    collectIds(settings, settings.expressions ?? [], async (response) => {
      const { Parameters, params } = await response.json();
      return (Parameters ?? params ?? []).map((parameter) => parameter?.Id ?? parameter?.id);
    }),
  ]);
  return { motion, expression };
}
