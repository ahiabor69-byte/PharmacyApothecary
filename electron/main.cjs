const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { startServer } = require("../server/index.cjs");

let server;
let mainWindow;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

async function createWindow() {
  server = await startServer();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#f5f1e8",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === "development") {
    await mainWindow.loadURL("http://127.0.0.1:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.show();
  mainWindow.focus();
}

if (hasSingleInstanceLock) {
  app.whenReady().then(createWindow);
}
app.on("render-process-gone", (_event, _webContents, details) => {
  console.error(`Renderer exited: ${details.reason}`);
});
process.on("uncaughtException", (error) => {
  console.error("Electron startup error:", error);
});
process.on("unhandledRejection", (error) => {
  console.error("Electron async error:", error);
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  if (server) server.close();
});
