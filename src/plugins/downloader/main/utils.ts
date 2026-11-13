import { app, type BrowserWindow } from 'electron';
import is from 'electron-is';

export const getFolder = (customFolder?: string) =>
  customFolder ?? app.getPath('downloads');

export const sendFeedback = (win: BrowserWindow, message?: unknown) => {
  win.webContents.send('downloader-feedback', message);
};

export const setBadge = (n: number) => {
  if (is.linux() || is.macOS()) {
    app.setBadgeCount(n);
  }
};
