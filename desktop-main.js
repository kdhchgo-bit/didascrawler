const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, Menu, session, shell } = require("electron");

let mainWindow = null;
let guiServer = null;

function getDataRoot() {
  const dir = path.join(app.getPath("documents"), "DohwaCrawler");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function createWindow() {
  process.env.DOHWA_DATA_ROOT = getDataRoot();
  const { createGuiServer } = require("./gui-server");
  const started = await createGuiServer({ port: 0, host: "127.0.0.1", open: false, silent: true });
  guiServer = started.server;

  session.defaultSession.on("will-download", (_event, item) => {
    const savePath = path.join(app.getPath("downloads"), item.getFilename());
    item.setSavePath(savePath);
  });

  mainWindow = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: "DIDAS 자동 업로드",
    backgroundColor: "#f4f6f8",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(started.url);
}

function closeServer() {
  if (!guiServer) return;
  guiServer.close();
  guiServer = null;
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    return createWindow();
  });

  app.on("window-all-closed", () => {
    closeServer();
    app.quit();
  });
}
