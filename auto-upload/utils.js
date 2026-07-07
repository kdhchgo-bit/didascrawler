const fs = require("fs");
const path = require("path");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveRuntimePath(value, baseDir) {
  if (!value) return "";
  const expanded = String(value).replace(/^~(?=$|[\\/])/, process.env.USERPROFILE || process.env.HOME || "~");
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(baseDir, expanded);
}

function safeFileName(value) {
  const cleaned = String(value || "upload")
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return (cleaned || "upload").slice(0, 180);
}

function startOfLocalDay(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseSince(value, now = new Date()) {
  if (!value) return startOfLocalDay(now);
  if (value === "today") return startOfLocalDay(now);

  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return new Date(now.getTime() - asNumber * 60 * 60 * 1000);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return startOfLocalDay(now);
  return parsed;
}

module.exports = {
  ensureDir,
  parseSince,
  readJson,
  resolveRuntimePath,
  safeFileName,
  startOfLocalDay,
  writeJson
};
