const fs = require("fs");
const path = require("path");
const { parseSearchResults, writeSearchResults } = require("./crawler");

function latestSearchResponse(outputDir) {
  const responseDir = path.join(outputDir, "responses");
  const files = fs
    .readdirSync(responseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.includes("search_search.do"))
    .map((entry) => {
      const filePath = path.join(responseDir, entry.name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.filePath;
}

function main() {
  const outputDir = path.resolve(__dirname, "outputs");
  const filePath = latestSearchResponse(outputDir);
  if (!filePath) {
    throw new Error(`No saved search_search.do response under ${path.join(outputDir, "responses")}`);
  }

  const entry = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const parsed = parseSearchResults(entry.body, entry.url);
  const payload = {
    query: new URL(entry.url).searchParams.get("query") || "",
    capturedAt: new Date().toISOString(),
    total: parsed.total,
    count: parsed.results.length,
    sourceResponse: path.relative(outputDir, filePath),
    results: parsed.results
  };
  writeSearchResults(outputDir, payload);
  console.log(JSON.stringify({ total: payload.total, count: payload.count, file: filePath }, null, 2));
}

main();
