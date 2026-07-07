const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

async function main() {
  const outputDir = path.resolve(__dirname, "outputs", "nxui");
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 950 },
    locale: "ko-KR"
  });

  await page.goto("https://didas.dohwa.co.kr/nxui/", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);

  const data = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("input, textarea, button, a, [role], canvas, iframe"));
    return nodes.map((el, index) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        index,
        tag: el.tagName.toLowerCase(),
        id: el.id || "",
        name: el.getAttribute("name") || "",
        type: el.getAttribute("type") || "",
        role: el.getAttribute("role") || "",
        placeholder: el.getAttribute("placeholder") || "",
        text: (el.innerText || el.value || "").trim().slice(0, 120),
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden",
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    });
  });

  fs.writeFileSync(
    path.join(outputDir, "dom.json"),
    JSON.stringify({ url: page.url(), data }, null, 2),
    "utf8"
  );
  await page.screenshot({ path: path.join(outputDir, "screenshot.png"), fullPage: true });
  await browser.close();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
