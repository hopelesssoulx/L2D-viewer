import { ViewerError } from "./i18n.js";

function resolvePath(modelPath, reference) {
  if (typeof reference !== "string" || !reference || /^(?:[\\/]|[a-z][a-z\d+.-]*:)/i.test(reference)) {
    return null;
  }

  const path = modelPath.split("/").slice(0, -1);
  for (const part of reference.replaceAll("\\", "/").split("/")) {
    if (part === "..") {
      if (path.length <= 1) return null;
      path.pop();
    } else if (part && part !== ".") {
      path.push(part);
    }
  }
  return path.join("/");
}

function findFile(filesByPath, modelPath, reference) {
  const exact = filesByPath.get(resolvePath(modelPath, reference));
  if (exact) return exact;

  try {
    const decoded = decodeURIComponent(reference);
    return filesByPath.get(resolvePath(modelPath, decoded));
  } catch {
    return undefined;
  }
}

// Each resource source supplies a model path, its JSON and a scoped file resolver.
class LocalModelSource {
  #filesByPath;
  #urls = new Map();

  constructor(file, filesByPath) {
    this.file = file;
    this.path = file.webkitRelativePath;
    const name = file.name.replace(/\.model3\.json$/i, "");
    this.name = name.toLowerCase() === "model" ? this.path.split("/").at(-2) : name;
    this.#filesByPath = filesByPath;
  }

  async readSettings() {
    try {
      return JSON.parse(await this.file.text());
    } catch {
      throw new ViewerError("invalidModelJSON");
    }
  }

  clone() {
    return new LocalModelSource(this.file, this.#filesByPath);
  }

  fileURL(reference) {
    const file = findFile(this.#filesByPath, this.path, reference);
    if (!file) throw new ViewerError("missingModelAsset", { path: reference });

    if (!this.#urls.has(file)) this.#urls.set(file, URL.createObjectURL(file));
    return this.#urls.get(file);
  }

  dispose() {
    for (const url of this.#urls.values()) URL.revokeObjectURL(url);
    this.#urls.clear();
  }
}

export function discoverLocalModels(files) {
  const filesByPath = new Map();
  let hasLegacyModel = false;
  for (const file of files) {
    if (!file.webkitRelativePath) continue;
    filesByPath.set(file.webkitRelativePath, file);
    if (/\.model\.json$/i.test(file.name)) hasLegacyModel = true;
  }

  const models = [...filesByPath.values()]
    .filter((file) => /\.model3\.json$/i.test(file.name))
    .sort((a, b) => a.webkitRelativePath.localeCompare(b.webkitRelativePath))
    .map((file) => new LocalModelSource(file, filesByPath));

  if (!models.length) {
    throw new ViewerError(hasLegacyModel ? "oldModelFormat" : "noModelJSON");
  }
  return models;
}
