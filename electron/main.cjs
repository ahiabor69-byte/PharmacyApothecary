const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { startServer } = require("../server/index.cjs");

let server;

async function createWindow() {
  server = await startServer();
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#f5f1e8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === "development") {
    await window.loadURL("http://127.0.0.1:5173");
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    await window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  if (server) server.close();
});
