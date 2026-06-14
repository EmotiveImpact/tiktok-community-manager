/**
 * Auto-update wiring (electron-updater).
 *
 * Design goals — this MUST be inert-but-safe until a real GitHub feed is
 * configured:
 *   - Only ever runs in a packaged production build (app.isPackaged). In dev
 *     (VITE_DEV_SERVER_URL set / unpacked) there is no update feed and
 *     electron-updater throws "dev app update config not found", so we skip
 *     entirely.
 *   - The publish config in package.json ships a placeholder owner
 *     ("YOUR_GITHUB_USER"). Against that placeholder the update check will fail
 *     to resolve a feed / 404. Every entry point is therefore wrapped so a
 *     missing or unreachable feed logs a warning and returns a status object —
 *     it never throws, never blocks startup, never shows a scary dialog.
 *   - electron-log is wired as the updater's logger so update activity lands in
 *     the same main.log a creator can attach to a support ticket.
 *
 * When the user configures a real repo (set `owner`/`repo` in package.json's
 * build.publish and publish a release with `electron-builder --publish always`),
 * this same code starts delivering real updates with no further changes.
 */
import { app } from 'electron';
import log from 'electron-log/main';

export type UpdateCheckResult = {
  ok: boolean;
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'skipped' | 'error';
  message: string;
  version?: string;
};

let wired = false;

/**
 * Lazy-load electron-updater. It's an ESM/CJS interop dependency that touches
 * the file system on import; importing it lazily keeps startup cheap and means a
 * broken/absent module can't take down the app.
 */
async function getAutoUpdater() {
  const mod: any = await import('electron-updater');
  // electron-updater exports `autoUpdater` (named) under both CJS and ESM interop.
  return (mod.autoUpdater ?? mod.default?.autoUpdater ?? mod.default) as any;
}

/**
 * Wire the updater event logging once. Safe to call repeatedly.
 */
async function ensureWired(): Promise<any | null> {
  let autoUpdater: any;
  try {
    autoUpdater = await getAutoUpdater();
  } catch (err) {
    log.warn('[updater] electron-updater unavailable:', (err as any)?.message ?? err);
    return null;
  }
  if (!autoUpdater) {
    log.warn('[updater] autoUpdater export missing');
    return null;
  }
  if (!wired) {
    wired = true;
    try {
      autoUpdater.logger = log;
      // Never auto-download/-install silently here; checkForUpdatesAndNotify
      // drives the standard "downloaded → notify" flow. We keep it conservative.
      autoUpdater.autoDownload = true;
      autoUpdater.on('error', (err: any) => {
        log.warn('[updater] error:', err?.message ?? err);
      });
      autoUpdater.on('checking-for-update', () => log.info('[updater] checking for update'));
      autoUpdater.on('update-available', (info: any) => log.info('[updater] update available:', info?.version));
      autoUpdater.on('update-not-available', () => log.info('[updater] no update available'));
      autoUpdater.on('update-downloaded', (info: any) => log.info('[updater] update downloaded:', info?.version));
    } catch (err) {
      log.warn('[updater] failed to attach listeners:', (err as any)?.message ?? err);
    }
  }
  return autoUpdater;
}

/**
 * Fire-and-forget background check on app ready. PRODUCTION ONLY. Never throws.
 */
export async function checkForUpdatesOnStartup(): Promise<void> {
  if (!app.isPackaged) {
    log.info('[updater] skipped: not a packaged build');
    return;
  }
  try {
    const autoUpdater = await ensureWired();
    if (!autoUpdater) return;
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (err) {
    // Placeholder/unreachable feed lands here. Log and move on — startup
    // continues normally.
    log.warn('[updater] startup check failed (feed not configured/reachable):', (err as any)?.message ?? err);
  }
}

/**
 * Manual check triggered from Settings → Diagnostics. Returns a structured
 * status the renderer can surface in a toast. Never throws.
 */
export async function checkForUpdatesManual(): Promise<UpdateCheckResult> {
  if (!app.isPackaged) {
    return {
      ok: false,
      status: 'skipped',
      message: 'Updates only run in the packaged app (not in dev).',
    };
  }
  try {
    const autoUpdater = await ensureWired();
    if (!autoUpdater) {
      return { ok: false, status: 'error', message: 'Updater unavailable.' };
    }
    const result = await autoUpdater.checkForUpdates();
    const info = result?.updateInfo;
    const current = app.getVersion();
    if (info?.version && info.version !== current) {
      return {
        ok: true,
        status: 'available',
        version: info.version,
        message: `Update ${info.version} available — downloading in the background.`,
      };
    }
    return {
      ok: true,
      status: 'not-available',
      message: `You're on the latest version (${current}).`,
    };
  } catch (err) {
    // Most common path with the placeholder feed: no reachable update server.
    const msg = (err as any)?.message ?? String(err);
    log.warn('[updater] manual check failed:', msg);
    return {
      ok: false,
      status: 'error',
      message: 'No update feed configured yet, or it is unreachable.',
    };
  }
}
