import { ViewerError } from "./i18n.js";
import { URLModelSource } from "./url-model-source.js";

const resources = new URL("../resources/", import.meta.url);

export function resourceModelName(path) {
  return path.split("/").at(-2) ?? path.replace(/(?:\.model3?)?\.json$/i, "");
}

export async function readResourceCatalog() {
  const response = await fetch(new URL("models.json", resources));
  if (!response.ok) throw new ViewerError("resourceListUnavailable");
  return Object.entries(await response.json());
}

export function resourceModelSource(path) {
  return new URLModelSource(new URL(path, resources).href, {
    path: `resources/${path}`,
    name: resourceModelName(path),
    scope: resources.href,
  });
}
