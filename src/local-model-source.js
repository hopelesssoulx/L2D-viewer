import { ViewerError } from "./i18n.js";

const modelFile = /(?:\.model3|(?:^|\.)model)\.json$/i;

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

  constructor(path, filesByPath) {
    this.file = filesByPath.get(path);
    this.path = path;
    const name = this.file.name.replace(/(?:\.model3?)?\.json$/i, "");
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
    return new LocalModelSource(this.path, this.#filesByPath);
  }

  fileURL(reference) {
    const file = findFile(this.#filesByPath, this.path, reference);
    if (!file) {
      const shared = /^\.\.[\\/]/.test(reference);
      throw new ViewerError(shared ? "missingSharedModelAsset" : "missingModelAsset", { path: reference });
    }

    if (!this.#urls.has(file)) this.#urls.set(file, URL.createObjectURL(file));
    return this.#urls.get(file);
  }

  dispose() {
    for (const url of this.#urls.values()) URL.revokeObjectURL(url);
    this.#urls.clear();
  }
}

export function discoverLocalModels(files) {
  const filesByPath = new Map(files.filter(([path]) => path));
  const models = [...filesByPath.keys()]
    .filter((path) => modelFile.test(filesByPath.get(path).name))
    .sort((a, b) => a.localeCompare(b))
    .map((path) => new LocalModelSource(path, filesByPath));

  if (!models.length) {
    throw new ViewerError("noModelJSON");
  }
  return models;
}
