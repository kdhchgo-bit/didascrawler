const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright-core");
const { login, submitSearch, attachNetworkRecorder, ensureDir } = require("./crawler");

function readConfig() {
  const raw = fs.readFileSync(path.resolve(__dirname, "config.json"), "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

async function main() {
  const config = readConfig();
  const outputDir = path.resolve(__dirname, "outputs", "cabinet-probe");
  ensureDir(outputDir);
  ensureDir(path.join(outputDir, "responses"));

  const context = await chromium.launchPersistentContext(path.resolve(__dirname, "session"), {
    executablePath: config.browser?.executablePath || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    locale: "ko-KR",
    viewport: { width: 1440, height: 950 },
    acceptDownloads: true,
    args: ["--disable-popup-blocking"]
  });
  const page = context.pages()[0] || (await context.newPage());
  page.on("dialog", async (dialog) => {
    console.log(`[dialog] ${dialog.message()}`);
    await dialog.accept().catch(() => {});
  });
  const recorder = attachNetworkRecorder(page, outputDir);

  try {
    await login(page, config);
    await submitSearch(page, config.search?.query || "자료", outputDir);
    await page.waitForTimeout(3000);
    const frame = page.frames().find((item) => item.url().includes("/search/search.do"));
    if (!frame) throw new Error("search iframe not found");

    const before = recorder.entries.length;
    const firstCabinetButton = frame.locator("button.btn_doc_sch").first();
    await firstCabinetButton.waitFor({ state: "visible", timeout: 30000 });
    await firstCabinetButton.click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(outputDir, "after-cabinet-click.png"), fullPage: true });

    // DUDAT0015P is rendered by Nexacro, not normal HTML. The default popup
    // location is stable at the configured viewport; click the visible OK button.
    await page.mouse.click(792, 287);
    await page.waitForTimeout(1000);
    await page.mouse.click(707, 541).catch(() => {});
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(outputDir, "after-cabinet-ok.png"), fullPage: true });

    const newEntries = recorder.entries.slice(before).map((entry) => ({
      url: entry.url,
      method: entry.method,
      status: entry.status,
      bodyType: typeof entry.body,
      bodyPreview: typeof entry.body === "string" ? entry.body.slice(0, 300) : entry.body
    }));
    fs.writeFileSync(path.join(outputDir, "after-cabinet-click.json"), JSON.stringify(newEntries, null, 2), "utf8");
    console.log(JSON.stringify(newEntries.map((entry) => `${entry.method} ${entry.status} ${entry.url}`), null, 2));
  } finally {
    await recorder.flush().catch(() => {});
    await context.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
