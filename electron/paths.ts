import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

const APP_FOLDER = 'LikeTapperMac';

export function appDocumentsDir(): string {
  const dir = path.join(app.getPath('documents'), APP_FOLDER);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sessionsDir(): string {
  const dir = path.join(appDocumentsDir(), 'sessions');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function chatlogsDir(): string {
  const dir = path.join(appDocumentsDir(), 'chatlogs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function clipsDir(): string {
  const dir = path.join(appDocumentsDir(), 'highlights');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function settingsFile(): string {
  return path.join(appDocumentsDir(), 'settings.json');
}
