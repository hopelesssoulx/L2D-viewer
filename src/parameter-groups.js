async function collectIds(settings, definitions, readIds) {
  const ids = new Set();
  const files = new Set(definitions.map(({ File }) => File));
  for (const file of files) {
    try {
      const response = await fetch(settings.resolveURL(file));
      if (!response.ok) continue;
      for (const id of readIds(await response.json())) {
        if (typeof id === "string") ids.add(id);
      }
    } catch {
      // A malformed clip is reported if the user tries to play it.
    }
  }
  return ids;
}

export async function readParameterGroups(settings) {
  const [motion, expression] = await Promise.all([
    collectIds(settings, Object.values(settings.motions ?? {}).flat(), ({ Curves }) =>
      (Curves ?? []).filter((curve) => curve?.Target === "Parameter").map(({ Id }) => Id)
    ),
    collectIds(settings, settings.expressions ?? [], ({ Parameters }) =>
      (Parameters ?? []).map((parameter) => parameter?.Id)
    ),
  ]);
  return { motion, expression };
}
