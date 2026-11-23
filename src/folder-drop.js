import { ViewerError } from "./i18n.js";

async function readEntry(entry, path, files) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    files.push([path, file]);
    return;
  }

  const reader = entry.createReader();
  while (true) {
    const entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!entries.length) return;
    await Promise.all(entries.map((child) => readEntry(child, `${path}/${child.name}`, files)));
  }
}

async function readFolders(folders) {
  if (!folders.length) throw new ViewerError("dropModelFolder");
  const files = [];
  const roots = new Set();
  try {
    await Promise.all(folders.map((folder) => {
      let name = folder.name;
      for (let suffix = 2; roots.has(name); suffix++) name = `${folder.name} (${suffix})`;
      roots.add(name);
      return readEntry(folder, name, files);
    }));
  } catch {
    throw new ViewerError("unreadableDroppedFolder");
  }
  return files;
}

export function setupFolderDrop(hint, isBusy, importFiles) {
  let depth = 0;
  const hasFiles = (event) => event.dataTransfer?.types.includes("Files");

  window.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth++;
    hint.hidden = isBusy();
  });
  window.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    const busy = isBusy();
    event.dataTransfer.dropEffect = busy ? "none" : "copy";
    hint.hidden = busy;
  });
  window.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) hint.hidden = true;
  });
  window.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    hint.hidden = true;
    if (isBusy()) return;

    // Read the entry handles while the browser still exposes the drag data.
    const folders = Array.from(event.dataTransfer.items, (item) => item.getAsEntry?.() ?? item.webkitGetAsEntry?.())
      .filter((entry) => entry?.isDirectory);
    importFiles(() => readFolders(folders));
  });
}
