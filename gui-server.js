const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright-core");
const { downloadSearchResults } = require("./crawler");

const APP_ROOT = __dirname;
const DATA_ROOT = path.resolve(process.env.DOHWA_DATA_ROOT || APP_ROOT);
const GUI_DIR = path.join(APP_ROOT, "gui");
const CRAWLER_PATH = path.join(APP_ROOT, "crawler.js");
const AUTO_UPLOAD_PATH = path.join(APP_ROOT, "auto-upload.js");
const CONFIG_PATH = path.join(DATA_ROOT, "config.json");
const OUTPUT_DIR = path.join(DATA_ROOT, "outputs");
const DOWNLOAD_DIR = path.join(OUTPUT_DIR, "downloads");
const DOWNLOAD_CACHE_PATH = path.join(OUTPUT_DIR, "download-cache.json");
const DOWNLOAD_FAILURES_PATH = path.join(OUTPUT_DIR, "download-failures.json");
const AUTO_UPLOAD_PLAN_PATH = path.join(OUTPUT_DIR, "auto-upload-plan.json");
const AUTO_UPLOAD_RESULT_PATH = path.join(OUTPUT_DIR, "auto-upload-result.json");
const PORT = Number(process.env.PORT || 3000);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const SEARCH_FILTER_KEYS = ["orderOfficeName", "departmentName", "participant"];
const AUTO_UPLOAD_KEYS = ["workDir", "since", "projectHint", "processHint", "categoryHint"];

const job = {
  running: false,
  pid: null,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  command: "",
  logs: []
};

let currentProcess = null;
let downloadContext = null;
let downloadContextPromise = null;

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

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeSearchFilters(filters = {}) {
  return SEARCH_FILTER_KEYS.reduce((normalized, key) => {
    normalized[key] = typeof filters?.[key] === "string" ? filters[key].trim() : "";
    return normalized;
  }, {});
}

function mergeSearchFilters(current = {}, patch = {}) {
  const merged = normalizeSearchFilters(current);
  if (!patch || typeof patch !== "object") return merged;
  for (const key of SEARCH_FILTER_KEYS) {
    if (typeof patch[key] === "string") merged[key] = patch[key].trim();
  }
  return merged;
}

function normalizeAutoUploadConfig(value = {}) {
  const normalized = {
    workDir: "",
    since: "today",
    limit: 50,
    projectHint: "",
    processHint: "",
    categoryHint: "",
    dryRun: true
  };
  if (!value || typeof value !== "object") return normalized;
  for (const key of AUTO_UPLOAD_KEYS) {
    if (typeof value[key] === "string") normalized[key] = value[key].trim();
  }
  if (Number.isFinite(Number(value.limit))) normalized.limit = Math.max(1, Number(value.limit));
  if (typeof value.dryRun === "boolean") normalized.dryRun = value.dryRun;
  return normalized;
}

function ensureRuntimeFiles() {
  ensureDir(DATA_ROOT);
  ensureDir(OUTPUT_DIR);
  ensureDir(DOWNLOAD_DIR);

  if (fs.existsSync(CONFIG_PATH)) return;

  const sourceConfig = path.join(APP_ROOT, "config.json");
  const exampleConfig = path.join(APP_ROOT, "config.example.json");
  if (fs.existsSync(sourceConfig)) {
    fs.copyFileSync(sourceConfig, CONFIG_PATH);
    return;
  }
  if (fs.existsSync(exampleConfig)) {
    fs.copyFileSync(exampleConfig, CONFIG_PATH);
    return;
  }
  writeJson(CONFIG_PATH, {
    credentials: { id: "", password: "" },
    search: {
      query: "자료",
      maxPages: 5,
      filters: normalizeSearchFilters()
    },
    browser: {
      headless: false,
      executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    },
    outputDir: "outputs",
    download: { enabled: true, limit: 12, copyToCabinet: false },
    autoUpload: normalizeAutoUploadConfig()
  });
}

function safeDownloadFileName(value) {
  const name = String(value || "download")
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return (name || "download").slice(0, 180);
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function publicConfig(config) {
  return {
    credentials: {
      id: config.credentials?.id || "",
      hasPassword: Boolean(config.credentials?.password)
    },
    search: {
      query: config.search?.query || "자료",
      maxPages: Number(config.search?.maxPages || 5),
      filters: normalizeSearchFilters(config.search?.filters)
    },
    browser: {
      headless: Boolean(config.browser?.headless),
      executablePath: config.browser?.executablePath || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    },
    outputDir: config.outputDir || "outputs",
    download: {
      enabled: config.download?.enabled !== false,
      limit: Number(config.download?.limit || 12),
      copyToCabinet: Boolean(config.download?.copyToCabinet)
    },
    autoUpload: normalizeAutoUploadConfig(config.autoUpload)
  };
}

function updateConfig(patch) {
  const config = readJson(CONFIG_PATH, {});
  config.credentials = config.credentials || {};
  config.search = config.search || {};
  config.browser = config.browser || {};
  config.download = config.download || {};
  config.autoUpload = config.autoUpload || {};

  if (typeof patch.credentials?.id === "string") config.credentials.id = patch.credentials.id.trim();
  if (typeof patch.credentials?.password === "string" && patch.credentials.password.length > 0) {
    config.credentials.password = patch.credentials.password;
  }
  if (typeof patch.search?.query === "string") config.search.query = patch.search.query.trim() || "자료";
  if (Number.isFinite(Number(patch.search?.maxPages))) config.search.maxPages = Number(patch.search.maxPages);
  if (patch.search?.filters && typeof patch.search.filters === "object") {
    config.search.filters = mergeSearchFilters(config.search.filters, patch.search.filters);
  }
  if (typeof patch.browser?.headless === "boolean") config.browser.headless = patch.browser.headless;
  if (typeof patch.browser?.executablePath === "string" && patch.browser.executablePath.trim()) {
    config.browser.executablePath = patch.browser.executablePath.trim();
  }
  if (typeof patch.download?.enabled === "boolean") config.download.enabled = patch.download.enabled;
  if (Number.isFinite(Number(patch.download?.limit))) config.download.limit = Number(patch.download.limit);
  if (typeof patch.download?.copyToCabinet === "boolean") {
    config.download.copyToCabinet = patch.download.copyToCabinet;
  }
  if (patch.autoUpload && typeof patch.autoUpload === "object") {
    config.autoUpload = normalizeAutoUploadConfig({ ...config.autoUpload, ...patch.autoUpload });
  }
  if (typeof patch.outputDir === "string" && patch.outputDir.trim()) config.outputDir = patch.outputDir.trim();

  writeJson(CONFIG_PATH, config);
  return publicConfig(config);
}

function pushLog(line) {
  const text = String(line || "").replace(/\r/g, "").trimEnd();
  if (!text) return;
  for (const item of text.split("\n")) {
    job.logs.push({ time: new Date().toISOString(), text: item });
  }
  if (job.logs.length > 2000) job.logs.splice(0, job.logs.length - 2000);
}

function resetJob() {
  job.running = false;
  job.pid = null;
  job.startedAt = null;
  job.finishedAt = null;
  job.exitCode = null;
  job.command = "";
  job.logs = [];
}

function clearOutputs() {
  ensureDir(OUTPUT_DIR);
  const root = path.resolve(DATA_ROOT);
  const target = path.resolve(OUTPUT_DIR);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clear outside project: ${target}`);
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const entryPath = path.join(target, entry.name);
    fs.rmSync(entryPath, { recursive: true, force: true });
  }
}

function buildCrawlerArgs(options) {
  const args = [CRAWLER_PATH, "--config", CONFIG_PATH];
  const query = String(options.query || "").trim();
  const maxPages = Number(options.maxPages || 5);
  const downloadLimit = Number(options.downloadLimit || 12);
  const filters = normalizeSearchFilters(options.filters);

  if (query) args.push("--query", query);
  if (Number.isFinite(maxPages) && maxPages > 0) args.push("--max-pages", String(maxPages));
  if (filters.orderOfficeName) args.push("--order-office", filters.orderOfficeName);
  if (filters.departmentName) args.push("--department", filters.departmentName);
  if (filters.participant) args.push("--participant", filters.participant);
  if (options.download) {
    args.push("--download");
    if (Number.isFinite(downloadLimit) && downloadLimit > 0) {
      args.push("--download-limit", String(downloadLimit));
    }
  }
  if (options.copyToCabinet) args.push("--copy-to-cabinet");
  args.push(options.headed ? "--headed" : "--headless");
  return args;
}

function buildAutoUploadArgs(options) {
  const args = [AUTO_UPLOAD_PATH, "--config", CONFIG_PATH];
  const autoUpload = normalizeAutoUploadConfig(options.autoUpload || options);
  if (autoUpload.workDir) args.push("--work-dir", autoUpload.workDir);
  if (autoUpload.since) args.push("--since", autoUpload.since);
  if (Number.isFinite(Number(autoUpload.limit)) && Number(autoUpload.limit) > 0) {
    args.push("--limit", String(autoUpload.limit));
  }
  if (autoUpload.projectHint) args.push("--project-hint", autoUpload.projectHint);
  if (autoUpload.processHint) args.push("--process-hint", autoUpload.processHint);
  if (autoUpload.categoryHint) args.push("--category-hint", autoUpload.categoryHint);
  args.push(autoUpload.dryRun ? "--dry-run" : "--upload");
  args.push(options.headed ? "--headed" : "--headless");
  return args;
}

async function startRun(req, res) {
  if (job.running) return sendJson(res, 409, { error: "이미 실행 중입니다." });

  const body = await readBody(req);
  await closeDownloadContext();
  const publicRuntimeConfig = updateConfig({
    credentials: body.credentials,
    search: {
      query: body.query,
      maxPages: Number(body.maxPages || 5),
      filters: body.filters
    },
    browser: {
      headless: !body.headed,
      executablePath: body.chromePath
    },
    download: {
      enabled: Boolean(body.download),
      limit: Number(body.downloadLimit || 12),
      copyToCabinet: Boolean(body.copyToCabinet)
    }
  });
  const runtimeConfig = readJson(CONFIG_PATH, {});
  if (!runtimeConfig.credentials?.id || !runtimeConfig.credentials?.password) {
    return sendJson(res, 400, { error: "아이디와 비밀번호를 먼저 저장하거나 입력해 주세요." });
  }

  if (body.clearOutputs) clearOutputs();

  resetJob();
  const args = buildCrawlerArgs(body);
  job.running = true;
  job.startedAt = new Date().toISOString();
  job.command = `node ${args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ")}`;
  pushLog(`[gui] ${job.command}`);

  currentProcess = spawn(process.execPath, args, {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      DOHWA_DATA_ROOT: DATA_ROOT,
      FORCE_COLOR: "0",
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {})
    },
    windowsHide: true
  });
  job.pid = currentProcess.pid;

  currentProcess.stdout.on("data", (chunk) => pushLog(chunk.toString("utf8")));
  currentProcess.stderr.on("data", (chunk) => pushLog(chunk.toString("utf8")));
  currentProcess.on("error", (error) => {
    pushLog(`[error] ${error.message}`);
  });
  currentProcess.on("close", (code) => {
    job.running = false;
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    pushLog(`[gui] finished with exit code ${code}`);
    currentProcess = null;
  });

  return sendJson(res, 200, { ok: true, job, config: publicRuntimeConfig });
}

async function startAutoUpload(req, res) {
  if (job.running) return sendJson(res, 409, { error: "이미 실행 중입니다." });

  const body = await readBody(req);
  await closeDownloadContext();
  const autoUpload = normalizeAutoUploadConfig({
    ...(body.autoUpload || {}),
    dryRun: body.dryRun !== false
  });
  const publicRuntimeConfig = updateConfig({
    credentials: body.credentials,
    browser: {
      headless: !body.headed,
      executablePath: body.chromePath
    },
    autoUpload
  });
  const runtimeConfig = readJson(CONFIG_PATH, {});
  if (!runtimeConfig.credentials?.id || !runtimeConfig.credentials?.password) {
    return sendJson(res, 400, { error: "ID와 비밀번호를 먼저 저장하거나 입력해 주세요." });
  }
  if (!runtimeConfig.autoUpload?.workDir) {
    return sendJson(res, 400, { error: "오늘 작업 파일을 찾을 작업 폴더를 입력해 주세요." });
  }

  resetJob();
  const args = buildAutoUploadArgs({
    autoUpload: runtimeConfig.autoUpload,
    headed: body.headed
  });
  job.running = true;
  job.startedAt = new Date().toISOString();
  job.command = `node ${args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ")}`;
  pushLog(`[gui] ${job.command}`);

  currentProcess = spawn(process.execPath, args, {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      DOHWA_DATA_ROOT: DATA_ROOT,
      FORCE_COLOR: "0",
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {})
    },
    windowsHide: true
  });
  job.pid = currentProcess.pid;

  currentProcess.stdout.on("data", (chunk) => pushLog(chunk.toString("utf8")));
  currentProcess.stderr.on("data", (chunk) => pushLog(chunk.toString("utf8")));
  currentProcess.on("error", (error) => {
    pushLog(`[error] ${error.message}`);
  });
  currentProcess.on("close", (code) => {
    job.running = false;
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    pushLog(`[gui] finished with exit code ${code}`);
    currentProcess = null;
  });

  return sendJson(res, 200, { ok: true, job, config: publicRuntimeConfig });
}

function stopRun(res) {
  if (!job.running || !currentProcess) return sendJson(res, 409, { error: "실행 중인 작업이 없습니다." });
  pushLog("[gui] stop requested");
  currentProcess.kill("SIGTERM");
  return sendJson(res, 200, { ok: true });
}

async function getDownloadContext() {
  if (downloadContext) return downloadContext;
  if (downloadContextPromise) return downloadContextPromise;

  const config = readJson(CONFIG_PATH, {});
  const executablePath =
    config.browser?.executablePath || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  downloadContextPromise = chromium
    .launchPersistentContext(path.join(DATA_ROOT, "session"), {
      executablePath,
      headless: true,
      locale: "ko-KR",
      viewport: { width: 1440, height: 950 },
      acceptDownloads: true,
      args: ["--disable-popup-blocking"]
    })
    .then((context) => {
      downloadContext = context;
      return context;
    })
    .finally(() => {
      downloadContextPromise = null;
    });
  return downloadContextPromise;
}

async function closeDownloadContext() {
  if (!downloadContext) return;
  await downloadContext.close().catch(() => {});
  downloadContext = null;
}

function walkFiles(dir, baseDir = dir, items = []) {
  if (!fs.existsSync(dir)) return items;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(filePath, baseDir, items);
    } else {
      const stat = fs.statSync(filePath);
      items.push({
        name: entry.name,
        relativePath: path.relative(baseDir, filePath).replace(/\\/g, "/"),
        fullPath: filePath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      });
    }
  }
  return items;
}

function filePayload(filePath) {
  const stat = fs.statSync(filePath);
  const relativePath = path.relative(DOWNLOAD_DIR, filePath).replace(/\\/g, "/");
  return {
    name: path.basename(filePath),
    relativePath,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    url: `/api/download?file=${encodeURIComponent(relativePath)}`
  };
}

function isErrorDownloadFile(filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return true;
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(2000);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytesRead).toString("utf8").trim().toLowerCase();
    return (
      sample.startsWith("<!doctype") ||
      sample.startsWith("<html") ||
      (sample.startsWith("ssv:") && /errorcode\s*=\s*-\d/i.test(sample)) ||
      (sample.startsWith("<?xml") && sample.includes("errorcode") && />\s*-\d+\s*</i.test(sample))
    );
  } finally {
    fs.closeSync(fd);
  }
}

function cleanDownloadErrorMessage(value) {
  const text = String(value || "다운로드에 실패했습니다.");
  const errorMsg = text.match(/<Parameter[^>]+id=["']ErrorMsg["'][^>]*>([\s\S]*?)<\/Parameter>/i)?.[1] || text;
  const cleaned = errorMsg
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^.*\[DIDAS\]\s*/i, "")
    .trim()
    .slice(0, 300);
  if (cleaned === "파일이 존재하지 않습니다") return "다운로드 권한이 없거나 원본 파일이 삭제되었습니다.";
  return cleaned;
}

function readDownloadCache() {
  return readJson(DOWNLOAD_CACHE_PATH, {});
}

function writeDownloadCache(cache) {
  ensureDir(OUTPUT_DIR);
  writeJson(DOWNLOAD_CACHE_PATH, cache);
}

function readDownloadFailures() {
  return readJson(DOWNLOAD_FAILURES_PATH, {});
}

function writeDownloadFailures(failures) {
  ensureDir(OUTPUT_DIR);
  writeJson(DOWNLOAD_FAILURES_PATH, failures);
}

function cacheDownloadFailure(docId, error) {
  if (!docId) return;
  const failures = readDownloadFailures();
  failures[docId] = {
    error: error || "다운로드 실패",
    capturedAt: new Date().toISOString()
  };
  writeDownloadFailures(failures);
}

function clearDownloadFailure(docId) {
  if (!docId) return;
  const failures = readDownloadFailures();
  if (!failures[docId]) return;
  delete failures[docId];
  writeDownloadFailures(failures);
}

function cacheDownloadedItem(docId, item) {
  if (!docId || !item?.path || !fs.existsSync(item.path) || isErrorDownloadFile(item.path)) return;
  const cache = readDownloadCache();
  cache[docId] = {
    path: item.path,
    title: item.title,
    bytes: item.bytes,
    capturedAt: new Date().toISOString()
  };
  writeDownloadCache(cache);
  clearDownloadFailure(docId);
}

function downloadedDocIdsFromManifests() {
  const ids = new Set();
  for (const file of walkFiles(DOWNLOAD_DIR).filter((item) => item.name === "download-manifest.json")) {
    const manifest = readJson(file.fullPath, null);
    for (const item of manifest?.items || []) {
      if (item.docId && item.path && fs.existsSync(item.path) && !isErrorDownloadFile(item.path)) ids.add(item.docId);
    }
  }
  for (const [docId, item] of Object.entries(readDownloadCache())) {
    if (item.path && fs.existsSync(item.path) && !isErrorDownloadFile(item.path)) ids.add(docId);
  }
  return ids;
}

function findDownloadedResult(docId) {
  const cached = readDownloadCache()[docId];
  if (cached?.path && fs.existsSync(cached.path) && !isErrorDownloadFile(cached.path)) return filePayload(cached.path);

  for (const file of walkFiles(DOWNLOAD_DIR).filter((item) => item.name === "download-manifest.json")) {
    const manifest = readJson(file.fullPath, null);
    const item = (manifest?.items || []).find(
      (entry) => entry.docId === docId && entry.path && fs.existsSync(entry.path) && !isErrorDownloadFile(entry.path)
    );
    if (item) return filePayload(item.path);
  }
  return null;
}

function expectedFileNameForResult(result) {
  let name = safeDownloadFileName(result.fileName || result.title || result.docId || "download");
  const extension = String(result.extension || "").replace(/^\./, "").trim();
  if (extension && path.extname(name).toLowerCase() !== `.${extension.toLowerCase()}`) {
    name = `${name}.${extension}`;
  }
  return name;
}

function findExistingFileForResult(search, result) {
  const queryDir = path.join(DOWNLOAD_DIR, safeDownloadFileName(search.query || "search"));
  const expected = expectedFileNameForResult(result).toLowerCase();
  const match = walkFiles(queryDir)
    .filter((file) => file.name.toLowerCase() === expected && !isErrorDownloadFile(file.fullPath))
    .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt))[0];
  return match ? filePayload(match.fullPath) : null;
}

function existingDownloadedDocIds(search) {
  const ids = new Set();
  const queryDir = path.join(DOWNLOAD_DIR, safeDownloadFileName(search.query || "search"));
  const existingNames = new Set(
    walkFiles(queryDir)
      .filter((file) => file.name !== "download-manifest.json" && !isErrorDownloadFile(file.fullPath))
      .map((file) => file.name.toLowerCase())
  );

  for (const row of search.results || []) {
    if (existingNames.has(expectedFileNameForResult(row).toLowerCase())) ids.add(row.docId);
  }
  return ids;
}

function compactSearch(search) {
  if (!search) return null;
  const downloaded = downloadedDocIdsFromManifests();
  for (const docId of existingDownloadedDocIds(search)) downloaded.add(docId);
  const failures = readDownloadFailures();
  return {
    query: search.query,
    capturedAt: search.capturedAt,
    total: search.total,
    count: search.count,
    unfilteredCount: search.unfilteredCount,
    filters: normalizeSearchFilters(search.filters),
    results: (search.results || []).map((row) => ({
      docId: row.docId,
      title: row.title,
      fileName: row.fileName,
      extension: row.extension,
      projectCode: row.projectCode,
      projectName: row.projectName,
      filePath: row.filePath,
      registeredAt: row.registeredAt,
      registeredBy: row.registeredBy,
      departmentName: row.departmentName,
      orderOfficeName: row.orderOfficeName,
      members: row.members,
      downloadYn: row.downloadYn,
      downloaded: downloaded.has(row.docId),
      downloadError: downloaded.has(row.docId) ? "" : failures[row.docId]?.error || ""
    }))
  };
}

function getResults() {
  const search = compactSearch(readJson(path.join(OUTPUT_DIR, "search-results.json"), null));
  const files = walkFiles(DOWNLOAD_DIR)
    .filter((file) => file.name !== "download-manifest.json" && file.name !== "download-cache.json")
    .filter((file) => !isErrorDownloadFile(file.fullPath))
    .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt))
    .map((file) => ({
      name: file.name,
      relativePath: file.relativePath,
      size: file.size,
      modifiedAt: file.modifiedAt,
      url: `/api/download?file=${encodeURIComponent(file.relativePath)}`
    }));
  const manifests = walkFiles(DOWNLOAD_DIR)
    .filter((file) => file.name === "download-manifest.json")
    .map((file) => readJson(file.fullPath, null))
    .filter(Boolean);
  const autoUpload = {
    plan: readJson(AUTO_UPLOAD_PLAN_PATH, null),
    result: readJson(AUTO_UPLOAD_RESULT_PATH, null)
  };

  return { search, files, manifests, autoUpload };
}

async function downloadResult(req, res) {
  if (job.running) return sendJson(res, 409, { error: "크롤러 실행 중에는 개별 다운로드를 시작할 수 없습니다." });

  const body = await readBody(req);
  const docId = String(body.docId || "").trim();
  if (!docId) return sendJson(res, 400, { error: "docId가 없습니다." });

  const search = readJson(path.join(OUTPUT_DIR, "search-results.json"), null);
  const result = (search?.results || []).find((row) => row.docId === docId);
  if (!result) return sendJson(res, 404, { error: "검색 결과에서 파일을 찾을 수 없습니다." });

  const existing = findDownloadedResult(docId) || findExistingFileForResult(search, result);
  if (existing) return sendJson(res, 200, { ok: true, cached: true, file: existing });

  const context = await getDownloadContext();
  const queryDir = safeDownloadFileName(search.query || "search");
  const downloadDir = path.join(DOWNLOAD_DIR, queryDir);
  const manifest = await downloadSearchResults(context, [result], downloadDir, 1, { writeManifest: false });
  const item = manifest[0];
  if (!item?.ok || !item.path || !fs.existsSync(item.path) || isErrorDownloadFile(item.path)) {
    if (item?.path && fs.existsSync(item.path) && isErrorDownloadFile(item.path)) fs.rmSync(item.path, { force: true });
    const error = cleanDownloadErrorMessage(item?.error);
    cacheDownloadFailure(docId, error);
    return sendJson(res, 502, { error });
  }

  cacheDownloadedItem(docId, item);
  return sendJson(res, 200, { ok: true, cached: false, file: filePayload(item.path) });
}

function serveDownload(req, res, url) {
  const relative = url.searchParams.get("file");
  if (!relative) return sendText(res, 400, "Missing file.");

  const filePath = path.resolve(DOWNLOAD_DIR, relative);
  const root = path.resolve(DOWNLOAD_DIR);
  const safeRelative = path.relative(root, filePath);
  if (
    safeRelative.startsWith("..") ||
    path.isAbsolute(safeRelative) ||
    !fs.existsSync(filePath) ||
    fs.statSync(filePath).isDirectory()
  ) {
    return sendText(res, 404, "Not found.");
  }

  const name = path.basename(filePath);
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": fs.statSync(filePath).size,
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
  });
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(GUI_DIR, `.${requested}`);
  const root = path.resolve(GUI_DIR);
  const safeRelative = path.relative(root, filePath);
  if (
    safeRelative.startsWith("..") ||
    path.isAbsolute(safeRelative) ||
    !fs.existsSync(filePath) ||
    fs.statSync(filePath).isDirectory()
  ) {
    return sendText(res, 404, "Not found.");
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME_TYPES[ext] || "application/octet-stream",
    "cache-control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, 200, publicConfig(readJson(CONFIG_PATH, {})));
    }
    if (req.method === "POST" && url.pathname === "/api/config") {
      return sendJson(res, 200, updateConfig(await readBody(req)));
    }
    if (req.method === "POST" && url.pathname === "/api/run") return startRun(req, res);
    if (req.method === "POST" && url.pathname === "/api/auto-upload/run") return startAutoUpload(req, res);
    if (req.method === "POST" && url.pathname === "/api/stop") return stopRun(res);
    if (req.method === "POST" && url.pathname === "/api/download-result") return downloadResult(req, res);
    if (req.method === "GET" && url.pathname === "/api/status") return sendJson(res, 200, job);
    if (req.method === "GET" && url.pathname === "/api/results") return sendJson(res, 200, getResults());
    if (req.method === "GET" && url.pathname === "/api/download") return serveDownload(req, res, url);
    if (req.method === "GET") return serveStatic(req, res, url);
    return sendText(res, 405, "Method not allowed.");
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

function openExternal(url) {
  const opener = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(opener, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

function createGuiServer(options = {}) {
  ensureRuntimeFiles();
  const port = Number.isFinite(Number(options.port)) ? Number(options.port) : PORT;
  const host = options.host || "127.0.0.1";
  const shouldOpen = options.open === true;
  const silent = options.silent === true;
  const server = http.createServer(handleRequest);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const actualHost = address.address === "::" ? "127.0.0.1" : address.address;
      const url = `http://${actualHost}:${address.port}`;
      if (!silent) console.log("Dohwa crawler server is running.");
      if (shouldOpen) openExternal(url);
      resolve({ server, url, dataRoot: DATA_ROOT });
    });
  });
}

if (require.main === module) {
  createGuiServer({ port: PORT, open: process.argv.includes("--open") || process.env.OPEN_GUI === "1" }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  createGuiServer,
  handleRequest,
  getResults,
  publicConfig,
  updateConfig
};
