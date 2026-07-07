const path = require("path");
const { chromium } = require("playwright-core");
const { attachNetworkRecorder, login } = require("../crawler");
const { ensureDir, writeJson } = require("./utils");

const HOME_URL = "https://platform.dohwa.co.kr/app/home";
const PROJECT_URL = "https://platform.dohwa.co.kr/app/project/my";

function browserExecutable(config) {
  return config.browser?.executablePath || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
}

async function createContext(config, dataRoot, headless) {
  ensureDir(dataRoot);
  return chromium.launchPersistentContext(path.join(dataRoot, "session"), {
    executablePath: browserExecutable(config),
    headless,
    locale: "ko-KR",
    viewport: { width: 1440, height: 950 },
    acceptDownloads: true,
    args: ["--disable-popup-blocking"]
  });
}

async function fetchProjectsFromPage(page) {
  const response = await page.evaluate(async () => {
    const result = await fetch("/api/home/my-project", {
      headers: { accept: "application/json, text/plain, */*" },
      credentials: "include"
    });
    if (!result.ok) return { ok: false, status: result.status, data: [] };
    const body = await result.json();
    return { ok: true, status: result.status, data: Array.isArray(body.data) ? body.data : [] };
  });
  if (!response.ok) throw new Error(`/api/home/my-project failed with HTTP ${response.status}`);
  return response.data;
}

async function fetchMyProjects(page, outputDir) {
  const responsePromise = page
    .waitForResponse((response) => response.url().includes("/api/home/my-project"), { timeout: 30000 })
    .catch(() => null);

  await page.goto(PROJECT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  const response = await responsePromise;
  let projects = [];
  if (response) {
    const body = await response.json().catch(() => null);
    projects = Array.isArray(body?.data) ? body.data : [];
  }
  if (!projects.length) projects = await fetchProjectsFromPage(page);
  writeJson(path.join(outputDir, "auto-upload-projects.json"), { capturedAt: new Date().toISOString(), projects });
  return projects;
}

async function openProject(page, item) {
  await page.goto(PROJECT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  const code = item.target.projectCode;
  const name = item.target.projectName;
  const candidates = [
    page.getByText(name, { exact: false }).first(),
    page.getByText(code, { exact: false }).first(),
    page.locator(`[data-prj-cd="${code}"], [data-prjcd="${code}"]`).first()
  ];

  for (const locator of candidates) {
    if (await locator.isVisible({ timeout: 3000 }).catch(() => false)) {
      await locator.click({ timeout: 5000 });
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
      return;
    }
  }

  throw new Error(`프로젝트를 화면에서 찾지 못했습니다: ${name || code}`);
}

async function chooseCategory(page, item) {
  const category = item.target.categoryName;
  const categoryNode = page.getByText(category, { exact: false }).first();
  if (await categoryNode.isVisible({ timeout: 5000 }).catch(() => false)) {
    await categoryNode.click({ timeout: 5000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    return;
  }
  throw new Error(`왼쪽 카테고리를 찾지 못했습니다: ${category}`);
}

async function attachFileAndSubmit(page, item) {
  const createButton = page
    .locator('button:has-text("새로 만들기"), button:has-text("업로드"), button:has-text("등록")')
    .first();
  if (await createButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await createButton.click({ timeout: 5000 }).catch(() => {});
  }

  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.waitFor({ state: "attached", timeout: 15000 });
  await fileInput.setInputFiles(item.file.path);

  const submit = page.locator('button:has-text("저장"), button:has-text("등록"), button:has-text("확인")').first();
  if (await submit.isVisible({ timeout: 5000 }).catch(() => false)) {
    await submit.click({ timeout: 5000 });
  }
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
}

async function uploadPlanItems(page, plan, options = {}) {
  const limit = Math.max(1, Number(options.limit || plan.items.length));
  const selected = plan.items.filter((item) => item.status === "planned").slice(0, limit);

  for (const item of selected) {
    try {
      await openProject(page, item);
      await chooseCategory(page, item);
      await attachFileAndSubmit(page, item);
      item.status = "uploaded";
      item.message = "업로드 자동화가 완료되었습니다.";
    } catch (error) {
      item.status = "failed";
      item.message = error.message;
    }
  }

  plan.summary.uploaded = plan.items.filter((item) => item.status === "uploaded").length;
  plan.summary.failed = plan.items.filter((item) => item.status === "failed").length;
  plan.summary.ready = plan.items.filter((item) => item.status === "planned").length;
  return plan;
}

async function withLoggedInPage(config, dataRoot, outputDir, headless, callback) {
  const context = await createContext(config, dataRoot, headless);
  const page = context.pages()[0] || (await context.newPage());
  const recorder = attachNetworkRecorder(page, outputDir);
  try {
    await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await login(page, config);
    return await callback(page, context);
  } finally {
    await recorder.flush().catch(() => {});
    await context.close();
  }
}

module.exports = {
  fetchMyProjects,
  uploadPlanItems,
  withLoggedInPage
};
