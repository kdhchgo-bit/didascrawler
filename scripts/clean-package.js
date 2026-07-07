const fs = require("fs");
const path = require("path");

const appDir = path.join(__dirname, "..", "dist", "DohwaCrawler-win32-x64", "resources", "app");

function remove(relativePath) {
  fs.rmSync(path.join(appDir, relativePath), { recursive: true, force: true });
}

for (const entry of ["config.json", "outputs", "session", "dist", "logs", "worker_scratch", "test"]) {
  remove(entry);
}

if (fs.existsSync(appDir)) {
  for (const entry of fs.readdirSync(appDir)) {
    if (/\.log$/i.test(entry)) remove(entry);
    if (/\.zip$/i.test(entry)) remove(entry);
  }
}
