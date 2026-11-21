async function collectIds(settings, definitions, readIds) {
  const ids = new Set();
  const files = new Set(definitions.map(({ File, file }) => File ?? file));
  await Promise.all([...files].map(async (file) => {
    try {
      const response = await fetch(settings.resolveURL(file));
      if (!response.ok) return;
      for (const id of await readIds(response)) {
        if (typeof id === "string") ids.add(id);
      }
    } catch {
      // A malformed clip is reported if the user tries to play it.
    }
  }));
  return ids;
}

export async function readParameterGroups(settings, cubism2) {
  const [motion, expression] = await Promise.all([
    collectIds(settings, Object.values(settings.motions ?? {}).flat(), async (response) => {
      if (cubism2) {
        const text = await response.text();
        return Array.from(text.matchAll(/^([^#=$\s][^=\r\n]*)=/gm), ([, id]) => id.trim());
      }
      const { Curves = [] } = await response.json();
      return Curves.filter((curve) => curve?.Target === "Parameter").map(({ Id }) => Id);
    }),
    collectIds(settings, settings.expressions ?? [], async (response) => {
      const { Parameters, params } = await response.json();
      return (Parameters ?? params ?? []).map((parameter) => parameter?.Id ?? parameter?.id);
    }),
  ]);
  return { motion, expression };
}
