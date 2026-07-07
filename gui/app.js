const els = {
  userId: document.getElementById("userId"),
  password: document.getElementById("password"),
  workDir: document.getElementById("workDir"),
  since: document.getElementById("since"),
  uploadLimit: document.getElementById("uploadLimit"),
  projectHint: document.getElementById("projectHint"),
  processHint: document.getElementById("processHint"),
  categoryHint: document.getElementById("categoryHint"),
  dryRun: document.getElementById("dryRun"),
  chromePath: document.getElementById("chromePath"),
  query: document.getElementById("query"),
  maxPages: document.getElementById("maxPages"),
  downloadLimit: document.getElementById("downloadLimit"),
  orderOfficeName: document.getElementById("orderOfficeName"),
  departmentName: document.getElementById("departmentName"),
  participant: document.getElementById("participant"),
  download: document.getElementById("download"),
  copyToCabinet: document.getElementById("copyToCabinet"),
  headed: document.getElementById("headed"),
  clearOutputs: document.getElementById("clearOutputs"),
  saveBtn: document.getElementById("saveBtn"),
  planBtn: document.getElementById("planBtn"),
  uploadBtn: document.getElementById("uploadBtn"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  statusText: document.getElementById("statusText"),
  pidText: document.getElementById("pidText"),
  logBox: document.getElementById("logBox"),
  uploadCards: document.getElementById("uploadCards"),
  uploadBody: document.getElementById("uploadBody"),
  uploadFilter: document.getElementById("uploadFilter"),
  uploadSummary: document.getElementById("uploadSummary"),
  resultsBody: document.getElementById("resultsBody"),
  resultFilter: document.getElementById("resultFilter"),
  resultTabs: document.getElementById("resultTabs"),
  resultSummary: document.getElementById("resultSummary"),
  fileList: document.getElementById("fileList"),
  fileSummary: document.getElementById("fileSummary")
};

const downloadingDocIds = new Set();
const MAX_RENDERED_RESULTS = 1000;
let lastRunning = false;
let lastResultsPayload = null;
let resultFilterText = "";
let uploadFilterText = "";
let activeDocType = "all";
let hasStoredPassword = false;
let sortState = {
  key: "registeredAt",
  direction: "desc"
};

const DOCUMENT_TYPE_GROUPS = [
  { key: "all", label: "전체", extensions: null },
  { key: "hwp", label: "HWP", extensions: ["hwp", "hwpx"] },
  { key: "excel", label: "XLS/XLSX", extensions: ["xls", "xlsx", "xlsm", "xlsb", "csv"] },
  { key: "dwg", label: "DWG", extensions: ["dwg", "dxf"] },
  { key: "zip", label: "ZIP", extensions: ["zip", "7z", "rar"] },
  { key: "ppt", label: "PPT/PPTX", extensions: ["ppt", "pptx", "pps", "ppsx"] },
  { key: "image", label: "JPG/PNG", extensions: ["jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "webp"] },
  { key: "pdf", label: "PDF", extensions: ["pdf"] },
  { key: "word", label: "DOC/DOCX", extensions: ["doc", "docx"] }
];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function normalizeSearchText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ko-KR");
}

function setPasswordState(hasPassword) {
  hasStoredPassword = Boolean(hasPassword);
  els.password.value = "";
  els.password.placeholder = hasStoredPassword ? "저장됨 - 변경할 때만 입력" : "비밀번호 입력";
  els.password.title = hasStoredPassword
    ? "저장된 비밀번호를 사용합니다. 변경할 때만 새 비밀번호를 입력하세요."
    : "처음 실행하거나 비밀번호를 저장하려면 입력하세요.";
}

function collectCredentials() {
  const credentials = { id: els.userId.value.trim() };
  if (els.password.value.length > 0 || !hasStoredPassword) credentials.password = els.password.value;
  return credentials;
}

function collectAutoUpload(dryRun = els.dryRun.checked) {
  return {
    workDir: els.workDir.value.trim(),
    since: els.since.value,
    limit: Number(els.uploadLimit.value || 50),
    projectHint: els.projectHint.value.trim(),
    processHint: els.processHint.value.trim(),
    categoryHint: els.categoryHint.value.trim(),
    dryRun
  };
}

function collectSearch() {
  return {
    query: els.query.value.trim() || "자료",
    maxPages: Number(els.maxPages.value || 5),
    downloadLimit: Number(els.downloadLimit.value || 12),
    filters: {
      orderOfficeName: els.orderOfficeName.value.trim(),
      departmentName: els.departmentName.value.trim(),
      participant: els.participant.value.trim()
    },
    download: els.download.checked,
    copyToCabinet: els.copyToCabinet.checked,
    clearOutputs: els.clearOutputs.checked
  };
}

function basePayload() {
  return {
    credentials: collectCredentials(),
    chromePath: els.chromePath.value.trim(),
    headed: els.headed.checked
  };
}

function renderConfig(config) {
  const filters = config.search?.filters || {};
  const autoUpload = config.autoUpload || {};
  els.userId.value = config.credentials?.id || "";
  setPasswordState(config.credentials?.hasPassword);
  els.workDir.value = autoUpload.workDir || "";
  els.since.value = autoUpload.since || "today";
  els.uploadLimit.value = autoUpload.limit || 50;
  els.projectHint.value = autoUpload.projectHint || "";
  els.processHint.value = autoUpload.processHint || "";
  els.categoryHint.value = autoUpload.categoryHint || "";
  els.dryRun.checked = autoUpload.dryRun !== false;
  els.chromePath.value = config.browser?.executablePath || "";
  els.query.value = config.search?.query || "자료";
  els.maxPages.value = config.search?.maxPages || 5;
  els.downloadLimit.value = config.download?.limit || 12;
  els.orderOfficeName.value = filters.orderOfficeName || "";
  els.departmentName.value = filters.departmentName || "";
  els.participant.value = filters.participant || "";
  els.download.checked = config.download?.enabled !== false;
  els.copyToCabinet.checked = Boolean(config.download?.copyToCabinet);
  els.headed.checked = !config.browser?.headless;
}

async function loadConfig() {
  renderConfig(await api("/api/config"));
}

async function saveConfig() {
  const search = collectSearch();
  const config = await api("/api/config", {
    method: "POST",
    body: JSON.stringify({
      credentials: collectCredentials(),
      search: {
        query: search.query,
        maxPages: search.maxPages,
        filters: search.filters
      },
      browser: {
        headless: !els.headed.checked,
        executablePath: els.chromePath.value.trim()
      },
      download: {
        enabled: search.download,
        limit: search.downloadLimit,
        copyToCabinet: search.copyToCabinet
      },
      autoUpload: collectAutoUpload()
    })
  });
  renderConfig(config);
  els.statusText.textContent = "설정 저장됨";
}

function setRunning(running) {
  els.startBtn.disabled = running;
  els.planBtn.disabled = running;
  els.uploadBtn.disabled = running;
  els.stopBtn.disabled = !running;
  els.saveBtn.disabled = running;
}

async function startSearchRun() {
  const result = await api("/api/run", {
    method: "POST",
    body: JSON.stringify({
      ...basePayload(),
      ...collectSearch()
    })
  });
  if (result.config) renderConfig(result.config);
  await refreshStatus();
}

async function startAutoUpload(forceDryRun) {
  const result = await api("/api/auto-upload/run", {
    method: "POST",
    body: JSON.stringify({
      ...basePayload(),
      autoUpload: collectAutoUpload(forceDryRun),
      dryRun: forceDryRun
    })
  });
  if (result.config) renderConfig(result.config);
  await refreshStatus();
}

async function stopRun() {
  await api("/api/stop", { method: "POST", body: "{}" });
  await refreshStatus();
}

function renderStatus(job) {
  setRunning(Boolean(job.running));
  if (job.running) {
    els.statusText.textContent = `실행 중 · ${formatTime(job.startedAt)}`;
  } else if (job.finishedAt) {
    els.statusText.textContent = job.exitCode === 0 ? `완료 · ${formatTime(job.finishedAt)}` : `실패 · 코드 ${job.exitCode}`;
  } else {
    els.statusText.textContent = "대기 중";
  }
  els.pidText.textContent = job.pid ? `PID ${job.pid}` : "";

  const atBottom = els.logBox.scrollTop + els.logBox.clientHeight >= els.logBox.scrollHeight - 12;
  els.logBox.textContent = (job.logs || []).map((entry) => entry.text).join("\n");
  if (atBottom || job.running) els.logBox.scrollTop = els.logBox.scrollHeight;
}

function uploadSearchText(item) {
  return normalizeSearchText(
    [
      item.file?.name,
      item.file?.relativePath,
      item.target?.projectCode,
      item.target?.projectName,
      item.target?.processName,
      item.target?.categoryName,
      item.target?.confidence,
      item.status,
      item.message
    ].join(" ")
  );
}

function renderUploadCards(summary) {
  const rows = [
    ["전체", summary.total || 0],
    ["준비", summary.ready || 0],
    ["보류", summary.blocked || 0],
    ["업로드", summary.uploaded || 0],
    ["실패", summary.failed || 0]
  ];
  els.uploadCards.innerHTML = rows
    .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function statusLabel(status) {
  const labels = {
    planned: "준비",
    blocked: "보류",
    uploaded: "완료",
    failed: "실패"
  };
  return labels[status] || status || "-";
}

function renderUpload(payload) {
  const data = payload?.autoUpload?.result || payload?.autoUpload?.plan;
  const items = data?.items || [];
  const filter = normalizeSearchText(uploadFilterText);
  const rows = filter ? items.filter((item) => uploadSearchText(item).includes(filter)) : items;
  renderUploadCards(data?.summary || {});
  els.uploadSummary.textContent = data ? `${rows.length} / ${items.length}개` : "0개";

  if (!rows.length) {
    els.uploadBody.innerHTML = `<tr><td class="empty" colspan="5">${data ? "조건에 맞는 파일 없음" : "업로드 계획 없음"}</td></tr>`;
    return;
  }

  els.uploadBody.innerHTML = rows
    .map((item) => {
      const confidence = item.target?.confidence || "low";
      return `
        <tr title="${escapeHtml(item.message || "")}">
          <td>
            <div class="file-name">${escapeHtml(item.file?.name || "")}</div>
            <div class="file-meta">${escapeHtml(item.file?.relativePath || "")} · ${formatBytes(item.file?.size)}</div>
          </td>
          <td>${escapeHtml(item.target?.projectName || item.target?.projectCode || "-")}</td>
          <td>${escapeHtml(item.target?.categoryName || item.target?.processName || "-")}</td>
          <td><span class="confidence-${escapeHtml(confidence)}">${escapeHtml(confidence)}</span></td>
          <td><span class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></td>
        </tr>
      `;
    })
    .join("");
}

function compareValues(a, b, key) {
  if (key === "downloaded") return Number(Boolean(a.downloaded)) - Number(Boolean(b.downloaded));
  if (key === "registeredAt") return new Date(a.registeredAt || 0).getTime() - new Date(b.registeredAt || 0).getTime();
  const left = String(a[key] || "").toLocaleLowerCase("ko-KR");
  const right = String(b[key] || "").toLocaleLowerCase("ko-KR");
  return left.localeCompare(right, "ko-KR", { numeric: true, sensitivity: "base" });
}

function sortedRows(rows) {
  const copied = [...rows];
  copied.sort((a, b) => {
    const result = compareValues(a, b, sortState.key);
    return sortState.direction === "asc" ? result : -result;
  });
  return copied;
}

function rowSearchText(row) {
  return normalizeSearchText(
    [
      row.title,
      row.fileName,
      row.extension,
      row.projectCode,
      row.projectName,
      row.processName,
      row.filePath,
      row.orderOfficeName,
      row.departmentName,
      row.registeredBy,
      row.registeredAt,
      row.members,
      row.category,
      row.content,
      row.downloadError,
      row.docId
    ].join(" ")
  );
}

function normalizeExtension(value) {
  return String(value || "").replace(/^\./, "").trim().toLocaleLowerCase("ko-KR");
}

function extensionFromRow(row) {
  const explicit = normalizeExtension(row.extension);
  if (explicit) return explicit;
  const fileName = String(row.fileName || row.title || "");
  const match = fileName.match(/\.([a-z0-9]+)\s*$/i);
  return normalizeExtension(match?.[1] || "");
}

function docTypeMatches(row, group) {
  if (!group || group.key === "all") return true;
  const extension = extensionFromRow(row);
  if (group.key === "unknown") return !extension;
  return Boolean(group.extensions?.includes(extension));
}

function buildDocTypeGroups(rows) {
  const knownExtensions = new Set(DOCUMENT_TYPE_GROUPS.flatMap((group) => group.extensions || []));
  const groups = DOCUMENT_TYPE_GROUPS.map((group) => ({
    ...group,
    count: group.key === "all" ? rows.length : rows.filter((row) => docTypeMatches(row, group)).length
  }));
  const dynamicCounts = new Map();
  let unknownCount = 0;

  for (const row of rows) {
    const extension = extensionFromRow(row);
    if (!extension) unknownCount += 1;
    else if (!knownExtensions.has(extension)) dynamicCounts.set(extension, (dynamicCounts.get(extension) || 0) + 1);
  }

  const dynamicGroups = Array.from(dynamicCounts, ([extension, count]) => ({
    key: `ext:${extension}`,
    label: extension.toLocaleUpperCase("ko-KR"),
    extensions: [extension],
    count
  })).sort((a, b) => a.label.localeCompare(b.label, "ko-KR", { numeric: true, sensitivity: "base" }));

  if (unknownCount > 0) dynamicGroups.push({ key: "unknown", label: "기타", extensions: [], count: unknownCount });
  return [...groups, ...dynamicGroups];
}

function renderDocTypeTabs(groups) {
  els.resultTabs.innerHTML = groups
    .map((group) => {
      const active = group.key === activeDocType;
      return `
        <button type="button" class="result-tab ${active ? "active" : ""}" data-doc-type="${escapeHtml(group.key)}" role="tab" aria-selected="${active ? "true" : "false"}">
          <span>${escapeHtml(group.label)}</span>
          <span class="result-tab-count">${group.count}</span>
        </button>
      `;
    })
    .join("");
}

function filterRows(rows) {
  const tokens = normalizeSearchText(resultFilterText).split(" ").filter(Boolean);
  if (!tokens.length) return rows;
  return rows.filter((row) => {
    const text = rowSearchText(row);
    return tokens.every((token) => text.includes(token));
  });
}

function updateSortHeaders() {
  document.querySelectorAll(".sort-head").forEach((button) => {
    const active = button.dataset.sort === sortState.key;
    button.classList.toggle("active", active);
    button.dataset.direction = active ? sortState.direction : "";
  });
}

function renderResults(payload) {
  lastResultsPayload = payload;
  renderUpload(payload);
  updateSortHeaders();
  const search = payload.search;
  const allRows = search?.results || [];
  const docTypeGroups = buildDocTypeGroups(allRows);
  const activeGroup = docTypeGroups.find((group) => group.key === activeDocType) || docTypeGroups[0];
  activeDocType = activeGroup?.key || "all";
  renderDocTypeTabs(docTypeGroups);

  const typeRows = activeGroup?.key === "all" ? allRows : allRows.filter((row) => docTypeMatches(row, activeGroup));
  const rows = sortedRows(filterRows(typeRows));
  const visibleRows = rows.slice(0, MAX_RENDERED_RESULTS);
  const filterActive = Boolean(normalizeSearchText(resultFilterText));
  const docTypeActive = activeDocType !== "all";
  els.resultSummary.textContent = search
    ? filterActive || docTypeActive
      ? `${rows.length} / ${allRows.length}건 · 전체 ${search.total ?? "-"}건`
      : `${rows.length} / ${search.total ?? "-"}건`
    : "0건";

  if (!rows.length) {
    els.resultsBody.innerHTML = `<tr><td class="empty" colspan="6">${filterActive || docTypeActive ? "선택한 조건의 결과 없음" : "검색 결과 없음"}</td></tr>`;
  } else {
    els.resultsBody.innerHTML = visibleRows
      .map((row) => {
        const downloadLabel = row.downloadError ? "재시도" : "받기";
        const rowTitle = row.downloadError ? `${row.title || ""}\n${row.downloadError}` : row.title || "";
        return `
          <tr class="result-row ${row.downloaded ? "downloaded" : ""} ${row.downloadError ? "download-failed" : ""}" data-doc-id="${escapeHtml(row.docId || "")}" title="${escapeHtml(rowTitle)}">
            <td><button type="button" class="result-title" data-doc-id="${escapeHtml(row.docId || "")}">${escapeHtml(row.title || row.fileName || "")}</button></td>
            <td>${escapeHtml(row.extension || "")}</td>
            <td>${escapeHtml(row.projectCode || "")}</td>
            <td>${escapeHtml(row.registeredAt || "")}</td>
            <td>${escapeHtml(row.registeredBy || "")}</td>
            <td><button type="button" class="row-download" data-doc-id="${escapeHtml(row.docId || "")}" data-default-label="${escapeHtml(downloadLabel)}">${escapeHtml(downloadLabel)}</button></td>
          </tr>
        `;
      })
      .join("");
  }

  const files = payload.files || [];
  els.fileSummary.textContent = `${files.length}개`;
  if (!files.length) {
    els.fileList.innerHTML = `<div class="empty">다운로드 파일 없음</div>`;
  } else {
    els.fileList.innerHTML = files
      .map(
        (file) => `
          <div class="file-item">
            <div>
              <div class="file-name" title="${escapeHtml(file.relativePath)}">${escapeHtml(file.name)}</div>
              <div class="file-meta">${formatBytes(file.size)} · ${formatTime(file.modifiedAt)}</div>
            </div>
            <a class="file-link" href="${file.url}">받기</a>
          </div>
        `
      )
      .join("");
  }
}

function setRowBusy(docId, busy) {
  const row = els.resultsBody.querySelector(`tr[data-doc-id="${CSS.escape(docId)}"]`);
  if (!row) return;
  row.classList.toggle("busy", busy);
  const button = row.querySelector(".row-download");
  if (button) {
    button.disabled = busy;
    button.textContent = busy ? "진행 중" : button.dataset.defaultLabel || "받기";
  }
}

async function downloadResult(docId) {
  if (!docId || downloadingDocIds.has(docId)) return;
  downloadingDocIds.add(docId);
  setRowBusy(docId, true);
  els.statusText.textContent = "선택 파일 다운로드 중";
  try {
    const result = await api("/api/download-result", {
      method: "POST",
      body: JSON.stringify({ docId })
    });
    await refreshResults();
    if (result.file?.url) {
      window.location.href = result.file.url;
      els.statusText.textContent = result.cached ? "이미 받은 파일 열기" : "다운로드 완료";
    }
  } catch (error) {
    els.statusText.textContent = error.message;
    await refreshResults().catch(() => {});
  } finally {
    downloadingDocIds.delete(docId);
    setRowBusy(docId, false);
  }
}

async function refreshStatus() {
  try {
    const wasRunning = lastRunning;
    const status = await api("/api/status");
    renderStatus(status);
    if (wasRunning && !status.running) await refreshResults();
    lastRunning = Boolean(status.running);
  } catch (error) {
    els.statusText.textContent = error.message;
  }
}

async function refreshResults() {
  renderResults(await api("/api/results"));
}

function switchView(view) {
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  document.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.panel !== view));
}

els.saveBtn.addEventListener("click", () => saveConfig().catch((error) => (els.statusText.textContent = error.message)));
els.planBtn.addEventListener("click", () => startAutoUpload(true).catch((error) => (els.statusText.textContent = error.message)));
els.uploadBtn.addEventListener("click", () => startAutoUpload(false).catch((error) => (els.statusText.textContent = error.message)));
els.startBtn.addEventListener("click", () => startSearchRun().catch((error) => (els.statusText.textContent = error.message)));
els.stopBtn.addEventListener("click", () => stopRun().catch((error) => (els.statusText.textContent = error.message)));
els.refreshBtn.addEventListener("click", () => {
  refreshStatus();
  refreshResults();
});
els.uploadFilter.addEventListener("input", () => {
  uploadFilterText = els.uploadFilter.value;
  if (lastResultsPayload) renderUpload(lastResultsPayload);
});
els.resultFilter.addEventListener("input", () => {
  resultFilterText = els.resultFilter.value;
  if (lastResultsPayload) renderResults(lastResultsPayload);
});
els.resultTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-doc-type]");
  if (!button) return;
  activeDocType = button.dataset.docType || "all";
  if (lastResultsPayload) renderResults(lastResultsPayload);
});
els.resultsBody.addEventListener("click", (event) => {
  const target = event.target.closest("[data-doc-id]");
  const row = event.target.closest("tr[data-doc-id]");
  const docId = target?.dataset.docId || row?.dataset.docId;
  if (docId) downloadResult(docId);
});
document.querySelectorAll(".sort-head").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.sort;
    if (sortState.key === key) {
      sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
    } else {
      sortState.key = key;
      sortState.direction = key === "registeredAt" || key === "downloaded" ? "desc" : "asc";
    }
    if (lastResultsPayload) renderResults(lastResultsPayload);
  });
});
document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view || "upload"));
});

loadConfig()
  .then(refreshStatus)
  .then(refreshResults)
  .catch((error) => {
    els.statusText.textContent = error.message;
  });

setInterval(refreshStatus, 1000);
setInterval(refreshResults, 5000);
