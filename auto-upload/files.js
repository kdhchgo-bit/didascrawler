const fs = require("fs");
const path = require("path");

const DEFAULT_EXTENSIONS = [
  ".hwp",
  ".hwpx",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".xlsm",
  ".ppt",
  ".pptx",
  ".dwg",
  ".dxf",
  ".zip",
  ".7z",
  ".rar",
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff"
];

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "outputs",
  "session",
  "worker_scratch",
  "logs",
  "$recycle.bin",
  "system volume information"
]);

function normalizeExtensions(extensions) {
  const source = Array.isArray(extensions) && extensions.length ? extensions : DEFAULT_EXTENSIONS;
  return new Set(
    source
      .map((extension) => String(extension || "").trim().toLowerCase())
      .filter(Boolean)
      .map((extension) => (extension.startsWith(".") ? extension : `.${extension}`))
  );
}

function shouldSkipDirectory(name) {
  return SKIP_DIRS.has(String(name || "").toLowerCase());
}

function toPayload(filePath, rootDir, stat) {
  return {
    path: filePath,
    relativePath: path.relative(rootDir, filePath).replace(/\\/g, "/"),
    name: path.basename(filePath),
    extension: path.extname(filePath).replace(/^\./, "").toLowerCase(),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString()
  };
}

function walkFiles(rootDir, options, items = []) {
  if (items.length >= options.limit) return items;

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(entry.name)) walkFiles(entryPath, options, items);
      continue;
    }
    if (!entry.isFile()) continue;

    const extension = path.extname(entry.name).toLowerCase();
    if (!options.extensions.has(extension)) continue;

    const stat = fs.statSync(entryPath);
    if (stat.mtime < options.since) continue;
    items.push(toPayload(entryPath, options.rootDir, stat));
    if (items.length >= options.limit) break;
  }
  return items;
}

function scanWorkFiles(input) {
  const rootDir = path.resolve(input.rootDir || "");
  if (!rootDir || !fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new Error(`작업 폴더를 찾을 수 없습니다: ${rootDir || "(비어 있음)"}`);
  }

  const options = {
    rootDir,
    since: input.since,
    limit: Math.max(1, Number(input.limit || 100)),
    extensions: normalizeExtensions(input.extensions)
  };

  return walkFiles(rootDir, options)
    .filter((file) => file.size > 0)
    .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
}

module.exports = {
  DEFAULT_EXTENSIONS,
  scanWorkFiles
};
