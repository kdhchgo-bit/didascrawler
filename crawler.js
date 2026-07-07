const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const LOGIN_URL = "https://platform.dohwa.co.kr/app/auth/sign-in";
const HOME_URL = "https://platform.dohwa.co.kr/app/home";
const SEARCH_MENU_CD = "00000000000194652907";
const API_PREFIXES = [
  "https://platform.dohwa.co.kr/api",
  "https://didas.dohwa.co.kr",
  "https://osm.dohwa.co.kr/api"
];

function parseArgs(argv) {
  const args = {
    config: "config.json",
    query: undefined,
    probe: false,
    headless: undefined,
    maxPages: undefined,
    download: false,
    downloadLimit: undefined,
    downloadDir: undefined,
    copyToCabinet: false,
    filters: {
      orderOfficeName: undefined,
      departmentName: undefined,
      participant: undefined
    }
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--probe") args.probe = true;
    else if (arg === "--config") args.config = argv[++i];
    else if (arg === "--query") args.query = argv[++i];
    else if (arg === "--max-pages") args.maxPages = Number(argv[++i]);
    else if (arg === "--download") args.download = true;
    else if (arg === "--download-limit") args.downloadLimit = Number(argv[++i]);
    else if (arg === "--download-dir") args.downloadDir = argv[++i];
    else if (arg === "--copy-to-cabinet") args.copyToCabinet = true;
    else if (arg === "--order-office") args.filters.orderOfficeName = argv[++i];
    else if (arg === "--department") args.filters.departmentName = argv[++i];
    else if (arg === "--participant") args.filters.participant = argv[++i];
    else if (arg === "--headless") args.headless = true;
    else if (arg === "--headed") args.headless = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function readConfig(filePath) {
  const resolved = path.resolve(__dirname, filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, "utf8").replace(/^\uFEFF/, "");
  const config = JSON.parse(raw);
  if (!config.credentials?.id || !config.credentials?.password) {
    throw new Error("config.json needs credentials.id and credentials.password.");
  }
  return config;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveRuntimePath(value) {
  const baseDir = process.env.DOHWA_DATA_ROOT || __dirname;
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function redactHeaders(headers) {
  const redacted = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase();
    if (
      lower.includes("token") ||
      lower === "cookie" ||
      lower === "authorization" ||
      lower === "set-cookie"
    ) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

function redactUrl(url) {
  try {
    const parsed = new URL(url);
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (key.toLowerCase().includes("token") || key.toLowerCase().includes("password")) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }
    return parsed.toString();
  } catch {
    return url.replace(/([?&][^=]*(?:token|password)[^=]*=)[^&]+/gi, "$1[REDACTED]");
  }
}

function summarizeAuthRequest(postData) {
  try {
    const parsed = JSON.parse(postData || "{}");
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [
        key,
        {
          type: typeof value,
          length: typeof value === "string" ? value.length : undefined,
          value: key.toLowerCase().includes("force") ? value : "[REDACTED]"
        }
      ])
    );
  } catch {
    return "[REDACTED_AUTH_REQUEST]";
  }
}

function redactPostData(url, postData) {
  if (!postData) return postData;
  if (url.includes("/auth/login")) return summarizeAuthRequest(postData);

  try {
    const parsed = JSON.parse(postData);
    return redactSensitive(parsed);
  } catch {
    return String(postData)
      .replace(
        /\b(info|loginMode|ApplicationGatewayAffinity|ApplicationGatewayAffinityCORS|JSESSIONID|accessToken|refreshToken|authorization|token|password|pwd)=([^\s&\r\n]+)/gi,
        "$1=[REDACTED]"
      )
      .replace(/(Cookie:\s*)[^\r\n]+/gi, "$1[REDACTED]");
  }
}

function isInterestingUrl(url) {
  return API_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function safeFileName(value) {
  return value
    .replace(/^https?:\/\//, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 180);
}

function safeDownloadFileName(value) {
  const name = String(value || "download")
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return (name || "download").slice(0, 180);
}

function uniquePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  for (let index = 2; index < 10000; index += 1) {
    const candidate = path.join(dir, `${base} (${index})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not create a unique file name for ${filePath}`);
}

function redactSensitive(value) {
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, nested] of Object.entries(value)) {
      const lower = key.toLowerCase();
      if (
        lower.includes("token") ||
        lower.includes("password") ||
        lower === "pwd" ||
        lower === "authorization"
      ) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactSensitive(nested);
      }
    }
    return result;
  }
  return value;
}

function responseBodyForLog(body) {
  return redactSensitive(body);
}

async function bodyFromResponse(response) {
  const contentType = response.headers()["content-type"] || "";
  try {
    if (contentType.includes("application/json")) {
      return await response.json();
    }
    const text = await response.text();
    return text.slice(0, 300000);
  } catch (error) {
    return `[UNREADABLE_RESPONSE: ${error.message}]`;
  }
}

function attachNetworkRecorder(page, outputDir) {
  const entries = [];

  page.on("response", async (response) => {
    const url = response.url();
    if (!isInterestingUrl(url)) return;

    const request = response.request();
    const postData = request.postData();
    const loggedUrl = redactUrl(url);
    const entry = {
      time: new Date().toISOString(),
      url: loggedUrl,
      method: request.method(),
      status: response.status(),
      resourceType: request.resourceType(),
      requestHeaders: redactHeaders(request.headers()),
      requestPostData: redactPostData(url, postData),
      responseHeaders: redactHeaders(response.headers()),
      body: responseBodyForLog(await bodyFromResponse(response))
    };
    entries.push(entry);

    const idx = String(entries.length).padStart(3, "0");
    const bodyPath = path.join(outputDir, "responses", `${idx}_${safeFileName(loggedUrl)}.json`);
    ensureDir(path.dirname(bodyPath));
    writeJson(bodyPath, entry);
  });

  return {
    entries,
    async flush() {
      writeJson(path.join(outputDir, "network-log.json"), entries);
    }
  };
}

async function visibleCount(locator) {
  const count = await locator.count();
  let visible = 0;
  for (let i = 0; i < count; i += 1) {
    if (await locator.nth(i).isVisible().catch(() => false)) visible += 1;
  }
  return visible;
}

async function clickFirstVisible(locator, timeout = 1000) {
  const count = await locator.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const item = locator.nth(i);
    if (await item.isVisible().catch(() => false)) {
      await item.click({ timeout });
      return true;
    }
  }
  return false;
}

async function login(page, config) {
  page.on("dialog", async (dialog) => {
    console.log(`[dialog] ${dialog.message()}`);
    await dialog.accept().catch(() => {});
  });

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const idInput = page.locator('input[placeholder="ID"], #userId').first();
  const passwordInput = page.locator('#userPwd, input[placeholder="PASSWORD"], input[type="password"]').first();
  const loginFormVisible = await passwordInput.isVisible({ timeout: 3000 }).catch(() => false);
  if (!page.url().includes("/auth/sign-in") && !loginFormVisible) {
    return;
  }

  await idInput.waitFor({ state: "visible", timeout: 30000 });
  await passwordInput.waitFor({ state: "visible", timeout: 30000 });
  await idInput.fill(config.credentials.id);
  await passwordInput.fill(config.credentials.password);

  const loginResponsePromise = page
    .waitForResponse((response) => response.url().includes("/api/auth/login"), { timeout: 30000 })
    .catch(() => null);
  await page.locator('button[type="submit"], button:has-text("Login")').first().click();
  const loginResponse = await loginResponsePromise;
  if (!loginResponse) {
    throw new Error("Login button did not call /api/auth/login. The page may not be hydrated or the selector changed.");
  }

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (!page.url().includes("/auth/sign-in")) break;

    const forceLoginButtons = page.locator(
      'button:has-text("확인"), button:has-text("예"), button:has-text("로그인"), button:has-text("강제")'
    );
    if ((await visibleCount(forceLoginButtons)) > 0) {
      await clickFirstVisible(forceLoginButtons, 2000);
    }
    await page.waitForTimeout(1000);
  }

  if (page.url().includes("/auth/sign-in")) {
    throw new Error("Login did not leave the sign-in page. Check credentials or forced-login prompt.");
  }

  await page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
}

async function dumpSearchCandidates(page, outputDir) {
  const candidates = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("input, textarea, [contenteditable='true'], button, a"));
    return nodes
      .map((el, index) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return {
          index,
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute("type"),
          id: el.id || undefined,
          name: el.getAttribute("name") || undefined,
          ariaLabel: el.getAttribute("aria-label") || undefined,
          placeholder: el.getAttribute("placeholder") || undefined,
          role: el.getAttribute("role") || undefined,
          text: (el.innerText || el.value || "").trim().slice(0, 120),
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none",
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      })
      .filter((item) => item.visible);
  });
  writeJson(path.join(outputDir, "dom-candidates.json"), candidates);
}

async function findSearchInput(page) {
  const selectors = [
    "#inpHomeSearch",
    'input[placeholder*="검색"]',
    'textarea[placeholder*="검색"]',
    'input[aria-label*="검색"]',
    'textarea[aria-label*="검색"]',
    'input[type="search"]',
    'input[placeholder*="Search" i]',
    'textarea[placeholder*="Search" i]',
    '[contenteditable="true"][aria-label*="검색"]',
    '[contenteditable="true"]'
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const candidate = locator.nth(i);
      if (!(await candidate.isVisible().catch(() => false))) continue;
      const box = await candidate.boundingBox().catch(() => null);
      if (!box || box.width < 80 || box.height < 12) continue;
      return candidate;
    }
  }

  const genericInputs = page.locator('input:not([type="hidden"]):not([type="password"]), textarea');
  const count = await genericInputs.count().catch(() => 0);
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < count; i += 1) {
    const item = genericInputs.nth(i);
    if (!(await item.isVisible().catch(() => false))) continue;
    const box = await item.boundingBox().catch(() => null);
    if (!box || box.width < 120 || box.height < 16) continue;
    const attrs = await item.evaluate((el) => ({
      id: el.id || "",
      name: el.getAttribute("name") || "",
      placeholder: el.getAttribute("placeholder") || "",
      type: el.getAttribute("type") || "",
      maxLength: el.getAttribute("maxlength") || ""
    }));
    const haystack = `${attrs.id} ${attrs.name} ${attrs.placeholder}`.toLowerCase();
    let score = box.width;
    if (haystack.includes("search") || haystack.includes("keyword") || haystack.includes("검색")) score += 1000;
    if (attrs.maxLength === "6") score -= 1000;
    if (attrs.type === "password") score -= 2000;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

async function submitSearch(page, query, outputDir, filters = {}) {
  const before = Date.now();
  const searchResponsePromise = page
    .waitForResponse((response) => response.url().includes("/search/search.do"), { timeout: 60000 })
    .catch(() => null);

  await page.goto(platformSearchUrl(query, filters), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  const directSearchResponse = await searchResponsePromise;
  if (directSearchResponse || page.frames().some((frame) => frame.url().includes("/search/search.do"))) {
    await page.waitForTimeout(1000);
    return before;
  }

  await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  const input = await findSearchInput(page);
  if (!input) {
    await dumpSearchCandidates(page, outputDir);
    await page.screenshot({ path: path.join(outputDir, "no-search-input.png"), fullPage: true });
    throw new Error("Could not find a visible search input. See dom-candidates.json and no-search-input.png.");
  }

  await input.click();
  await input.fill(query).catch(async () => {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.type(query);
  });

  const fallbackStartedAt = Date.now();
  const fallbackSearchResponsePromise = page
    .waitForResponse((response) => response.url().includes("/search/search.do"), { timeout: 60000 })
    .catch(() => null);
  await input.press("Enter").catch(() => page.keyboard.press("Enter"));
  await page.waitForTimeout(1200);

  const homeSearchButton = page.locator("#inpHomeSearch + button");
  if ((await visibleCount(homeSearchButton)) > 0) {
    await clickFirstVisible(homeSearchButton, 2000);
  }

  const searchButton = page.locator(
    'button:has-text("검색"), a:has-text("검색"), button[aria-label*="검색"], [role="button"][aria-label*="검색"]'
  );
  if ((await visibleCount(searchButton)) > 0) {
    await clickFirstVisible(searchButton, 2000);
  }

  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  const searchResponse = await fallbackSearchResponsePromise;
  if (!searchResponse) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (page.frames().some((frame) => frame.url().includes("/search/search.do"))) break;
      await page.waitForTimeout(500);
    }
  }
  await page.waitForTimeout(1000);
  return fallbackStartedAt;
}

async function crawlNextPages(page, maxPages) {
  const visited = [];
  for (let pageNo = 2; pageNo <= maxPages; pageNo += 1) {
    const next = page.locator(
      'button:has-text("다음"), a:has-text("다음"), button[aria-label*="next" i], a[aria-label*="next" i], button[aria-label*="다음"], a[aria-label*="다음"]'
    );
    if ((await visibleCount(next)) === 0) break;
    await clickFirstVisible(next, 3000);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    visited.push({ pageNo, url: page.url(), time: new Date().toISOString() });
  }
  return visited;
}

function collectArrayRows(value, rows = [], sourcePath = "$") {
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === "object" && !Array.isArray(item))) {
      rows.push({ path: sourcePath, count: value.length, rows: value.slice(0, 5000) });
    }
    value.forEach((item, index) => collectArrayRows(item, rows, `${sourcePath}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      collectArrayRows(nested, rows, `${sourcePath}.${key}`);
    }
  }
  return rows;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripTags(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

const SEARCH_FILTERS = {
  orderOfficeName: { label: "발주처", field: "orderOfficeName", param: "contract_office" },
  departmentName: { label: "담당부서", field: "departmentName", param: "dept" },
  participant: { label: "참여자", field: "members", param: "member" }
};

function normalizeSearchFilters(filters = {}) {
  return Object.fromEntries(
    Object.keys(SEARCH_FILTERS).map((key) => [key, typeof filters?.[key] === "string" ? filters[key].trim() : ""])
  );
}

function resolveSearchFilters(args, config) {
  const configured = normalizeSearchFilters(config.search?.filters);
  return normalizeSearchFilters({
    orderOfficeName: args.filters.orderOfficeName ?? configured.orderOfficeName,
    departmentName: args.filters.departmentName ?? configured.departmentName,
    participant: args.filters.participant ?? configured.participant
  });
}

function normalizeFilterText(value) {
  return stripTags(value).toLocaleLowerCase("ko-KR");
}

function textMatchesFilter(value, filter) {
  const tokens = normalizeFilterText(filter).split(" ").filter(Boolean);
  if (!tokens.length) return true;
  const text = normalizeFilterText(value);
  return tokens.every((token) => text.includes(token));
}

function rowMatchesSearchFilters(row, filters) {
  return Object.entries(SEARCH_FILTERS).every(([key, { field }]) => textMatchesFilter(row[field], filters[key]));
}

function applySearchFilters(searchResults, filters) {
  const normalizedFilters = normalizeSearchFilters(filters);
  const hasActiveFilter = Object.values(normalizedFilters).some(Boolean);
  if (!hasActiveFilter) {
    return {
      ...searchResults,
      filters: normalizedFilters
    };
  }

  const originalResults = searchResults.results || [];
  const results = originalResults.filter((row) => rowMatchesSearchFilters(row, normalizedFilters));
  return {
    ...searchResults,
    filters: normalizedFilters,
    unfilteredCount: originalResults.length,
    count: results.length,
    results
  };
}

function formatSearchFilters(filters) {
  return Object.entries(normalizeSearchFilters(filters))
    .filter(([, value]) => value)
    .map(([key, value]) => `${SEARCH_FILTERS[key].label}=${value}`)
    .join(", ");
}

function appendSearchFilterParams(searchParams, filters) {
  for (const [key, value] of Object.entries(normalizeSearchFilters(filters))) {
    if (value) searchParams.set(SEARCH_FILTERS[key].param, value);
  }
}

function formatDtt(value) {
  const text = String(value || "");
  if (!/^\d{8}/.test(text)) return text;
  const yyyy = text.slice(0, 4);
  const mm = text.slice(4, 6);
  const dd = text.slice(6, 8);
  if (text.length < 14) return `${yyyy}.${mm}.${dd}`;
  return `${yyyy}-${mm}-${dd} ${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}`;
}

function normalizeResultData(raw) {
  return {
    docId: raw.DOCID || "",
    title: stripTags(raw.FILE_NM || raw.TITLE || ""),
    fileName: stripTags(raw.FILE_NM || ""),
    extension: raw.FILE_EXT || "",
    fileGroup: raw.FILE_GRP || "",
    fileRefCd: raw.FILE_REF_CD || "",
    filePhysicalPath: raw.FILE_PHY_PATH || "",
    downloadYn: raw.DOWNLOAD_YN || "",
    projectCode: raw.PRJ_CD || raw.IMS_PRJ_NUM || "",
    projectName: stripTags(raw.PRJ_NM || ""),
    processName: stripTags(raw.PROC_NM || ""),
    filePath: stripTags(raw.FILE_PATH || ""),
    orderOfficeName: stripTags(raw.ORDER_OFFICE_NAME || ""),
    departmentName: stripTags(raw.DEPT_NM || ""),
    registeredBy: stripTags(raw.REG_USR_NM || ""),
    registeredAt: formatDtt(raw.REG_DTT || ""),
    members: stripTags(raw.PRJ_MEMBER || ""),
    category: stripTags(raw.GUBUUN || ""),
    content: stripTags(raw.CONTENT || "").slice(0, 2000),
    raw
  };
}

function extractSearchHtmlEntries(entries) {
  return entries.filter(
    (entry) =>
      entry.status === 200 &&
      entry.url.includes("/search/search.do") &&
      typeof entry.body === "string" &&
      entry.body.includes("showViewNX")
  );
}

function extractSearchHtmlFromEntries(entries) {
  const candidates = extractSearchHtmlEntries(entries);
  return candidates.length ? candidates[candidates.length - 1] : null;
}

function mergeSearchResultPages(pages) {
  const results = [];
  const seen = new Set();
  let total = null;

  for (const page of pages) {
    if (total === null && page.parsed.total !== null) total = page.parsed.total;
    for (const item of page.parsed.results) {
      const key = `${item.docId}|${item.fileRefCd}|${item.fileName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        ...item,
        pageNo: page.pageNo,
        startCount: page.startCount
      });
    }
  }

  return { total, results };
}

function parseSearchResults(html, sourceUrl) {
  const totalMatch = html.match(/검색결과\s*총\s*([\d,]+)\s*건/);
  const results = [];
  const seen = new Set();
  const callPattern = /(?:showViewNX|saveToCabinetNX)\(([\s\S]*?)\);/g;

  for (const match of html.matchAll(callPattern)) {
    const jsonText = decodeHtmlEntities(match[1]);
    let raw;
    try {
      raw = JSON.parse(jsonText);
    } catch {
      continue;
    }
    const item = normalizeResultData(raw);
    item.resultClass = item.extension;
    item.sourceUrl = sourceUrl;
    const key = `${item.docId}|${item.fileRefCd}|${item.fileName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }

  return {
    total: totalMatch ? Number(totalMatch[1].replace(/,/g, "")) : null,
    results
  };
}

function didasSearchUrl(query, startCount = 0, filters = {}) {
  const url = new URL("https://didas.dohwa.co.kr/search/search.do");
  url.searchParams.set("query", query);
  url.searchParams.set("startCount", String(Math.max(0, Number(startCount) || 0)));
  appendSearchFilterParams(url.searchParams, filters);
  return url.toString();
}

function platformSearchUrl(query, filters = {}) {
  const filterParams = Object.entries(normalizeSearchFilters(filters))
    .filter(([, value]) => value)
    .map(([key, value]) => `&${SEARCH_FILTERS[key].param}=${value}`)
    .join("");
  return `https://platform.dohwa.co.kr/app/didas-classic?contsCd=${encodeURIComponent(
    `${SEARCH_MENU_CD}&query=${query}${filterParams}`
  )}`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeSearchResults(outputDir, parsed) {
  const jsonPath = path.join(outputDir, "search-results.json");
  const csvPath = path.join(outputDir, "search-results.csv");
  writeJson(jsonPath, parsed);

  const columns = [
    "docId",
    "title",
    "extension",
    "projectCode",
    "projectName",
    "filePath",
    "registeredAt",
    "registeredBy",
    "departmentName",
    "orderOfficeName",
    "members",
    "fileRefCd",
    "downloadYn",
    "content"
  ];
  const lines = [columns.join(",")];
  for (const row of parsed.results) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  }
  fs.writeFileSync(csvPath, `\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

function decodeJwtPayload(token) {
  if (!token || token.split(".").length < 2) return null;
  const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
  try {
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function getUsrCd(context) {
  const cookies = await context.cookies();
  const cookieTokens = cookies.map((cookie) => cookie.value).filter((value) => String(value).split(".").length >= 3);
  for (const token of cookieTokens) {
    const payload = decodeJwtPayload(token);
    const usrCd = payload?.usrCd || payload?.userCd || payload?.sub;
    if (usrCd) return usrCd;
  }

  const storageState = await context.storageState().catch(() => null);
  const storageValues = (storageState?.origins || []).flatMap((origin) =>
    (origin.localStorage || []).map((item) => item.value)
  );
  for (const value of storageValues) {
    const payload = decodeJwtPayload(value);
    const usrCd = payload?.usrCd || payload?.userCd || payload?.sub;
    if (usrCd) return usrCd;
  }

  return "";
}

function filenameFromContentDisposition(value) {
  const header = String(value || "");
  const encoded = header.match(/filename\*=([^;]+)/i)?.[1]?.trim();
  if (encoded) {
    const encodedValue = encoded.replace(/^UTF-8''/i, "").replace(/^"|"$/g, "");
    try {
      return decodeURIComponent(encodedValue);
    } catch {
      return encodedValue;
    }
  }

  const basic = header.match(/filename="?([^";]+)"?/i)?.[1]?.trim();
  if (!basic) return "";
  try {
    return decodeURIComponent(basic);
  } catch {
    return basic;
  }
}

function resultDownloadName(result, responseHeaders) {
  let name =
    filenameFromContentDisposition(responseHeaders["content-disposition"]) ||
    result.fileName ||
    result.title ||
    result.docId ||
    "download";
  name = safeDownloadFileName(name);

  const extension = String(result.extension || "").replace(/^\./, "").trim();
  if (extension && path.extname(name).toLowerCase() !== `.${extension.toLowerCase()}`) {
    name = `${name}.${extension}`;
  }
  return name;
}

function looksLikeDownloadError(response, body) {
  const headers = response.headers();
  const contentType = headers["content-type"] || "";
  const sample = body.subarray(0, 2000).toString("utf8").trim().toLowerCase();
  return (
    contentType.includes("text/html") ||
    sample.startsWith("<!doctype") ||
    sample.startsWith("<html") ||
    (sample.startsWith("ssv:") && /errorcode\s*=\s*-\d/i.test(sample)) ||
    (sample.startsWith("<?xml") && sample.includes("errorcode") && />\s*-\d+\s*</i.test(sample))
  );
}

async function downloadSearchResults(context, results, downloadDir, limit, options = {}) {
  ensureDir(downloadDir);

  const usrCd = await getUsrCd(context);
  if (!usrCd) console.log("[download] usrCd was not found; trying fileAttCd-only download URL");

  const selected = results.filter((result) => result.docId).slice(0, limit);
  const manifest = [];

  for (const [index, result] of selected.entries()) {
    const url =
      `https://didas.dohwa.co.kr/mng/comm/file/downloadFile.do?fileAttCd=${encodeURIComponent(result.docId)}` +
      (usrCd ? `&usrCd=${encodeURIComponent(usrCd)}` : "");
    const response = await context.request.get(url, {
      timeout: 180000,
      headers: {
        Referer: "https://didas.dohwa.co.kr/nxui/"
      }
    });
    const body = await response.body();
    const item = {
      index: index + 1,
      docId: result.docId,
      title: result.title,
      status: response.status(),
      ok: response.ok(),
      bytes: body.length,
      path: null,
      error: null
    };

    if (!response.ok() || looksLikeDownloadError(response, body)) {
      item.ok = false;
      item.error = body.subarray(0, 1000).toString("utf8");
      manifest.push(item);
      continue;
    }

    const filePath = uniquePath(path.join(downloadDir, resultDownloadName(result, response.headers())));
    fs.writeFileSync(filePath, body);
    item.path = filePath;
    manifest.push(item);
    console.log(`[download] ${item.index}/${selected.length} ${path.basename(filePath)} (${item.bytes} bytes)`);
  }

  if (options.writeManifest !== false) {
    writeJson(path.join(downloadDir, "download-manifest.json"), {
      capturedAt: new Date().toISOString(),
      count: manifest.length,
      successCount: manifest.filter((item) => item.ok && item.path).length,
      items: manifest
    });
  }
  return manifest;
}

function getSearchFrame(page) {
  return page.frames().find((frame) => frame.url().includes("/search/search.do"));
}

async function copyVisibleSearchResultsToCabinet(page, outputDir, limit) {
  const frame = getSearchFrame(page);
  if (!frame) {
    throw new Error("Search result iframe was not found, so cabinet copy cannot run.");
  }

  const buttons = frame.locator("button.btn_doc_sch");
  const available = await buttons.count().catch(() => 0);
  const selectedCount = Math.min(available, limit);
  const copies = [];

  for (let index = 0; index < selectedCount; index += 1) {
    const button = buttons.nth(index);
    const folderPromise = page
      .waitForResponse((response) => response.url().includes("/mng/comm/folder/selectFolderTreeList.do"), {
        timeout: 30000
      })
      .catch(() => null);
    const copyPromise = page
      .waitForResponse((response) => response.url().includes("/comm/file/copyFile.do"), { timeout: 30000 })
      .catch(() => null);

    await button.scrollIntoViewIfNeeded().catch(() => {});
    await button.click({ timeout: 15000 });
    await folderPromise;
    await page.waitForTimeout(700);
    await page.mouse.click(792, 287);

    const copyResponse = await copyPromise;
    const body = copyResponse ? await copyResponse.text().catch(() => "") : "";
    const ok = Boolean(copyResponse && copyResponse.ok() && /ErrorCode\s*[:=]\s*(int=)?0/i.test(body));
    copies.push({
      index: index + 1,
      ok,
      status: copyResponse?.status() || null,
      bodyPreview: body.slice(0, 500)
    });
    console.log(`[cabinet] ${index + 1}/${selectedCount} ${ok ? "copied" : "failed"}`);
    await page.waitForTimeout(800);
  }

  writeJson(path.join(outputDir, "cabinet-copy.json"), {
    capturedAt: new Date().toISOString(),
    count: copies.length,
    successCount: copies.filter((item) => item.ok).length,
    items: copies
  });
  return copies;
}

async function fetchDirectSearchResults(context, outputDir, query, maxPages = 1, filters = {}) {
  const pageLimit = Math.max(1, Number(maxPages) || 1);
  const pages = [];
  const seen = new Set();
  let startCount = 0;
  let pageSize = 0;

  for (let pageNo = 1; pageNo <= pageLimit; pageNo += 1) {
    const url = didasSearchUrl(query, startCount, filters);
    const response = await context.request.get(url, {
      timeout: 120000,
      headers: {
        Referer: "https://didas.dohwa.co.kr/nxui/"
      }
    });
    const html = await response.text();
    fs.writeFileSync(path.join(outputDir, pageNo === 1 ? "direct-search.html" : `direct-search-page-${pageNo}.html`), html, "utf8");

    const parsed = parseSearchResults(html, url);
    const hasNewRows = parsed.results.some((item) => {
      const key = `${item.docId}|${item.fileRefCd}|${item.fileName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    pages.push({ pageNo, startCount, parsed });
    console.log(`[search] direct page ${pageNo}/${pageLimit}: ${parsed.results.length} row(s)`);

    if (parsed.results.length === 0 || (pageNo > 1 && !hasNewRows)) break;
    pageSize = pageSize || parsed.results.length;
    if (parsed.total !== null && startCount + parsed.results.length >= parsed.total) break;
    startCount += pageSize;
  }

  const parsed = mergeSearchResultPages(pages);
  const savedSearchResults = applySearchFilters({
    query,
    capturedAt: new Date().toISOString(),
    total: parsed.total,
    count: parsed.results.length,
    pageCount: pages.length,
    results: parsed.results
  }, filters);
  writeSearchResults(outputDir, savedSearchResults);
  return savedSearchResults;
}

async function extractPageArtifacts(page, outputDir, query, networkEntries, searchStartedAt, filters = {}) {
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map((anchor) => ({
      text: (anchor.innerText || "").trim(),
      href: anchor.href
    }))
  );
  const visibleText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  const html = await page.content();
  const searchEntries = networkEntries.filter((entry) => Date.parse(entry.time) >= searchStartedAt - 500);
  const rowCandidates = searchEntries.flatMap((entry) =>
    collectArrayRows(entry.body).map((candidate) => ({
      url: entry.url,
      status: entry.status,
      ...candidate
    }))
  );
  const searchHtmlEntries = extractSearchHtmlEntries(searchEntries);
  const parsedSearchResults = mergeSearchResultPages(
    searchHtmlEntries.map((entry, index) => ({
      pageNo: index + 1,
      startCount: null,
      parsed: parseSearchResults(entry.body, entry.url)
    }))
  );
  const savedSearchResults = applySearchFilters({
    query,
    capturedAt: new Date().toISOString(),
    total: parsedSearchResults.total,
    count: parsedSearchResults.results.length,
    pageCount: searchHtmlEntries.length,
    results: parsedSearchResults.results
  }, filters);
  writeSearchResults(outputDir, savedSearchResults);

  writeJson(path.join(outputDir, "result-links.json"), links);
  fs.writeFileSync(path.join(outputDir, "page-text.txt"), visibleText, "utf8");
  fs.writeFileSync(path.join(outputDir, "page.html"), html, "utf8");
  writeJson(path.join(outputDir, "search-responses.json"), searchEntries);
  writeJson(path.join(outputDir, "extracted.json"), {
    query,
    url: page.url(),
    capturedAt: new Date().toISOString(),
    filters: normalizeSearchFilters(filters),
    responseCount: searchEntries.length,
    searchPageCount: searchHtmlEntries.length,
    searchResultCount: parsedSearchResults.results.length,
    searchFilteredCount: savedSearchResults.count,
    searchResultTotal: parsedSearchResults.total,
    rowCandidates,
    links
  });
  await page.screenshot({ path: path.join(outputDir, "search-result.png"), fullPage: true });
  return savedSearchResults;
}

async function main() {
  const args = parseArgs(process.argv);
  const config = readConfig(args.config);
  const query = args.query ?? config.search?.query ?? "자료";
  const maxPages = args.maxPages ?? config.search?.maxPages ?? 5;
  const searchFilters = resolveSearchFilters(args, config);
  const outputDir = resolveRuntimePath(config.outputDir || "outputs");
  const downloadEnabled = args.download || Boolean(config.download?.enabled);
  const copyToCabinet = args.copyToCabinet || Boolean(config.download?.copyToCabinet);
  const downloadLimit = args.downloadLimit ?? config.download?.limit;
  ensureDir(outputDir);
  ensureDir(path.join(outputDir, "responses"));

  const executablePath =
    config.browser?.executablePath || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const headless = args.headless ?? config.browser?.headless ?? false;
  const userDataDir = resolveRuntimePath(config.sessionDir || "session");
  ensureDir(userDataDir);

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless,
    locale: "ko-KR",
    viewport: { width: 1440, height: 950 },
    acceptDownloads: true,
    args: ["--disable-popup-blocking"]
  });

  const page = context.pages()[0] || (await context.newPage());
  const recorder = attachNetworkRecorder(page, outputDir);

  try {
    console.log("[1/4] login");
    await login(page, config);
    console.log(`[2/4] search: ${query}`);
    const filterLog = formatSearchFilters(searchFilters);
    if (filterLog) console.log(`[filter] ${filterLog}`);
    const searchStartedAt = await submitSearch(page, query, outputDir, searchFilters);
    if (!args.probe && maxPages > 1) {
      console.log(`[3/4] next pages up to ${maxPages}`);
      const pages = await crawlNextPages(page, maxPages);
      writeJson(path.join(outputDir, "visited-pages.json"), pages);
    } else {
      console.log("[3/4] page crawl skipped");
    }
    console.log("[4/4] save artifacts");
    let savedSearchResults = await extractPageArtifacts(page, outputDir, query, recorder.entries, searchStartedAt, searchFilters);
    if (!args.probe && maxPages > 1) {
      console.log(`[search] fetch direct result pages up to ${maxPages}`);
      const directSearchResults = await fetchDirectSearchResults(context, outputDir, query, maxPages, searchFilters).catch((error) => {
        console.log(`[search] direct pagination failed: ${error.message}`);
        return null;
      });
      if (directSearchResults && directSearchResults.results.length >= savedSearchResults.results.length) {
        savedSearchResults = directSearchResults;
      }
    }
    if (savedSearchResults.results.length === 0) {
      console.log("[search] no rows captured from browser; trying direct search endpoint");
      savedSearchResults = await fetchDirectSearchResults(context, outputDir, query, maxPages, searchFilters);
    }

    const availableResultCount = savedSearchResults.results.length;
    const requestedLimit = Number.isFinite(downloadLimit) ? Math.max(0, downloadLimit) : availableResultCount;
    const resultLimit = Math.min(availableResultCount, requestedLimit);
    console.log(`[search] ${availableResultCount} result row(s) captured`);
    if (savedSearchResults.unfilteredCount !== undefined) {
      console.log(`[filter] ${availableResultCount}/${savedSearchResults.unfilteredCount} row(s) matched`);
    }

    if (copyToCabinet && resultLimit > 0) {
      console.log(`[cabinet] copy ${resultLimit} visible result(s) to My Cabinet`);
      await copyVisibleSearchResultsToCabinet(page, outputDir, resultLimit);
    }
    if (downloadEnabled && resultLimit > 0) {
      const configuredDownloadDir = args.downloadDir ?? config.download?.dir ?? path.join(outputDir, "downloads");
      const downloadDir = path.resolve(resolveRuntimePath(configuredDownloadDir), safeDownloadFileName(query));
      console.log(`[download] save up to ${resultLimit} file(s) to ${downloadDir}`);
      await downloadSearchResults(context, savedSearchResults.results, downloadDir, resultLimit);
    } else if (downloadEnabled) {
      console.log("[download] skipped because no search result rows were captured");
    }
    await recorder.flush();
  } finally {
    await recorder.flush().catch(() => {});
    await context.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  login,
  submitSearch,
  attachNetworkRecorder,
  ensureDir,
  parseSearchResults,
  writeSearchResults,
  downloadSearchResults,
  copyVisibleSearchResultsToCabinet
};
