import { ViewerError } from "./i18n.js";

const resources = new URL("../resources/", import.meta.url);
let nextInstance = 0;

function resourceURL(path, base = resources) {
  const url = new URL(path.replaceAll("\\", "/"), base);
  if (!url.href.startsWith(resources.href)) {
    throw new ViewerError("missingModelAsset", { path });
  }
  return url;
}

export function resourceModelName(path) {
  return path.split("/").at(-2) ?? path.replace(/(?:\.model3?)?\.json$/i, "");
}

export async function readResourceCatalog() {
  const response = await fetch(new URL("models.json", resources));
  if (!response.ok) throw new ViewerError("resourceListUnavailable");
  return Object.entries(await response.json());
}

export class ResourceModelSource {
  #entry;
  #manifest;
  #instance = ++nextInstance;

  constructor(path) {
    this.#entry = path;
    this.#manifest = resourceURL(path);
    this.path = `resources/${path}`;
    this.name = resourceModelName(path);
  }

  async readSettings() {
    try {
      const response = await fetch(this.#manifest);
      if (!response.ok) throw new Error(response.status);
      return await response.json();
    } catch {
      throw new ViewerError("invalidModelJSON");
    }
  }

  fileURL(reference) {
    const url = resourceURL(reference, this.#manifest);
    // Pixi keys its texture cache by the full URL. HTTP requests omit the fragment.
    url.hash = `model-${this.#instance}`;
    return url.href;
  }

  clone() {
    return new ResourceModelSource(this.#entry);
  }

  dispose() {}
}
