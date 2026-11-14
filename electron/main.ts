import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

let mainWindow: BrowserWindow | null = null;
let serverHandle: { port: number; close: () => Promise<void> } | null = null;

async function bootstrapDesktop(): Promise<void> {
  const userDataDir = path.join(app.getPath('userData'), 'strenx-data');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  process.env.STRENX_DATA_DIR = userDataDir;
  process.env.STRENX_EMBEDDED_IN_ELECTRON = '1';
  process.env.NODE_ENV = app.isPackaged ? 'production' : (process.env.NODE_ENV || 'development');

  const serverModulePath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'dist-server', 'server.mjs')
    : path.resolve(process.cwd(), 'server.ts');

  const { startServer } = await import(serverModulePath);
  serverHandle = await startServer(0);

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    title: 'Strenx WhatsApp Sender',
    backgroundColor: '#F6F8F7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadURL(`http://127.0.0.1:${serverHandle.port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('strenx:get-app-info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  dataDir: process.env.STRENX_DATA_DIR || '',
  isDesktop: true,
}));

ipcMain.handle('strenx:open-data-folder', async () => {
  const dir = process.env.STRENX_DATA_DIR;
  if (dir && fs.existsSync(dir)) {
    await shell.openPath(dir);
  }
});

app.whenReady().then(bootstrapDesktop);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (serverHandle) {
    await serverHandle.close().catch(() => {});
    serverHandle = null;
  }
});
