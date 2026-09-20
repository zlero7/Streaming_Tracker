'use strict';

/**
 * 방송 체크 - Windows(exe) 데스크톱 앱
 * 내부에서 server.js를 빈 포트로 띄우고, 그 주소를 창에 보여준다.
 * 등록 목록은 사용자 데이터 폴더(예: %APPDATA%\StreamerTracker\data)에 저장된다.
 */

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow = null;

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const { start } = require('../server.js');
    const server = await start({
      host: '127.0.0.1',
      port: 0,
      dataDir: path.join(app.getPath('userData'), 'data'),
    });
    const origin = `http://127.0.0.1:${server.address().port}`;

    Menu.setApplicationMenu(null);
    mainWindow = new BrowserWindow({
      width: 1120,
      height: 820,
      minWidth: 380,
      minHeight: 520,
      title: '방송 체크',
      icon: path.join(__dirname, 'icon.png'),
      backgroundColor: '#edeff4',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });

    // 방송 링크는 앱 안이 아니라 기본 브라우저로 연다
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(origin)) event.preventDefault();
    });

    mainWindow.loadURL(origin);
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  });

  app.on('window-all-closed', () => app.quit());
}
