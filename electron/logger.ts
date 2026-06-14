/**
 * Structured logging for the Electron main process.
 *
 * Wraps electron-log with a rotating file transport (written to
 * app.getPath('logs') — the OS-conventional per-app log directory) plus the
 * usual console transport in dev. Every message is level-tagged and the file is
 * size-capped so logs never grow unbounded on a long-running stream.
 *
 * Why this exists: the #1 creator complaint about competitors is mid-stream
 * crashes/freezes with no way to tell WHY. A persistent, attachable log lets a
 * creator (or support) reconstruct exactly what the live connection did before
 * it broke — sign-server rate limits, stalls, reconnect storms, etc.
 *
 * Usage:
 *   import { log } from './logger';
 *   log.info('[tiktok] connected', { username });
 *   log.error('[tiktok] connect failed', err);
 */
import log from 'electron-log/main';
import { app, shell } from 'electron';
import path from 'node:path';

let initialized = false;

/**
 * Configure transports. Safe to call multiple times — only the first call
 * applies configuration. Must run after `app` is available (it is, since this
 * module is imported from the main process).
 */
function init(): void {
  if (initialized) return;
  initialized = true;

  // File transport → app.getPath('logs') (e.g. ~/Library/Logs/<AppName>/ on
  // macOS). electron-log creates the directory automatically.
  log.transports.file.level = 'info';
  log.transports.file.fileName = 'main.log';
  // Rotate at ~5 MB; electron-log archives the old file as main.old.log.
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

  // Console transport: verbose in dev, quieter when packaged.
  log.transports.console.level = app.isPackaged ? 'warn' : 'debug';
  log.transports.console.format = '[{level}] {text}';

  // Surface uncaught exceptions / unhandled rejections into the log file so a
  // hard crash still leaves a breadcrumb the user can attach to a ticket.
  log.errorHandler.startCatching({ showDialog: false });
}

init();

/** The configured logger. Prefer the tagged convenience methods below. */
export { log };

/**
 * Absolute path to the directory electron-log writes to. Resolved lazily so it
 * reflects the real per-app logs path once the app name is known.
 */
export function logsDir(): string {
  // electron-log resolves the file inside app.getPath('logs'); derive the
  // directory from the resolved file path so the two can never drift.
  try {
    const file = log.transports.file.getFile?.().path;
    if (file) return path.dirname(file);
  } catch {
    /* fall through */
  }
  return app.getPath('logs');
}

/** Open the logs folder in the OS file manager. Returns the opened path. */
export async function revealLogs(): Promise<{ ok: boolean; path: string; error?: string }> {
  const dir = logsDir();
  try {
    const err = await shell.openPath(dir);
    // openPath resolves to '' on success, or an error string on failure.
    if (err) return { ok: false, path: dir, error: err };
    return { ok: true, path: dir };
  } catch (e: any) {
    return { ok: false, path: dir, error: e?.message ?? String(e) };
  }
}
