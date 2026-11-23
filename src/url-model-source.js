import { ViewerError } from "./i18n.js";

let nextInstance = 0;

function httpURL(address, base) {
  if (typeof address === "string" && address.trim()) {
    let url;
    try { url = new URL(address, base); } catch {}
    if (url && (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) return url;
  }
  throw new ViewerError("invalidModelURL");
}

function modelName(url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const filename = (parts.at(-1) ?? url.hostname).replace(/(?:\.model3?)?\.json$/i, "");
  const name = filename.toLowerCase() === "model" ? parts.at(-2) ?? filename : filename;
  try { return decodeURIComponent(name); } catch { return name; }
}

export class URLModelSource {
  #manifest;
  #base;
  #scope;
  #instance = ++nextInstance;

  constructor(address, { name, path, scope } = {}) {
    this.#manifest = httpURL(address);
    this.#base = this.#manifest;
    this.#scope = scope;
    this.#checkScope(this.#manifest);
    this.name = name ?? modelName(this.#manifest);
    this.path = path ?? this.#manifest.origin + this.#manifest.pathname;
  }

  #checkScope(url) {
    if (this.#scope && !url.href.startsWith(this.#scope)) {
      throw new ViewerError("missingModelAsset", { path: url.pathname });
    }
  }

  async readSettings() {
    let response;
    try {
      response = await fetch(this.#manifest);
    } catch {
      throw new ViewerError("modelURLFetchFailed");
    }
    if (!response.ok) throw new ViewerError("modelURLHTTPError", { status: response.status });

    // A redirected manifest resolves its relative references from its final location.
    this.#base = httpURL(response.url || this.#manifest.href);
    this.#checkScope(this.#base);
    try {
      return await response.json();
    } catch {
      throw new ViewerError("invalidModelJSON");
    }
  }

  fileURL(reference) {
    const url = httpURL(reference.replaceAll("\\", "/"), this.#base);
    this.#checkScope(url);
    // Pixi keys its texture cache by the full URL. HTTP requests omit the fragment.
    url.hash = `model-${this.#instance}`;
    return url.href;
  }

  clone() {
    return new URLModelSource(this.#manifest.href, { name: this.name, path: this.path, scope: this.#scope });
  }

  dispose() {}
}
