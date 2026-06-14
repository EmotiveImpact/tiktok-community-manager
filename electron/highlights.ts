import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import ffmpegStatic from 'ffmpeg-static';
import { clipsDir as docsClipsDir } from './paths';

let ffmpegPath: string | null | undefined;
let recorder: { proc: ReturnType<typeof spawn>; tmpFile: string; hlsUrl: string } | null = null;

const BUFFER_SECONDS = 60;

/**
 * Resolve the bundled ffmpeg-static binary in a packaging-safe way.
 *
 * `ffmpeg-static` exports the absolute path to a per-platform ffmpeg binary that
 * ships inside node_modules. When the app is packaged, node_modules is rolled
 * into the asar archive — but a native executable cannot run from inside an asar,
 * so electron-builder must be told to keep it on disk. We do that via
 * `asarUnpack` in package.json:
 *
 *     "build": { "asarUnpack": ["**\/node_modules/ffmpeg-static/**"] }
 *
 * electron-builder then places the binary under `app.asar.unpacked/...` and the
 * path ffmpeg-static reports still points at `app.asar/...`. So we rewrite
 * 'app.asar' → 'app.asar.unpacked' and only use it if the file actually exists
 * on disk. (NOTE: package.json is owned by the build orchestrator — the
 * asarUnpack glob above must be present there for packaged highlights to work.
 * In dev / unpacked runs the path resolves directly and no rewrite is needed.)
 */
function resolveBundledFfmpeg(): string | null {
  const raw = ffmpegStatic as unknown as string | null;
  if (!raw || typeof raw !== 'string') return null;
  const candidates = [raw];
  if (raw.includes('app.asar' + path.sep) || raw.includes('app.asar/')) {
    candidates.unshift(raw.replace('app.asar', 'app.asar.unpacked'));
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* try next */ }
  }
  return null;
}

function detectFfmpeg(): string | null {
  if (ffmpegPath !== undefined) return ffmpegPath;

  // 1) Prefer the bundled ffmpeg-static binary — it ships with the app, so
  //    highlights work out of the box on every platform (incl. Macs without
  //    Homebrew and Windows machines with no ffmpeg on PATH). Verify it actually
  //    runs before committing to it.
  const bundled = resolveBundledFfmpeg();
  if (bundled) {
    try {
      const r = spawnSync(bundled, ['-version'], { stdio: 'ignore' });
      if (r.status === 0) {
        ffmpegPath = bundled;
        return bundled;
      }
    } catch { /* fall through to PATH probes */ }
  }

  // 2) Fall back to a system ffmpeg on PATH / common install locations.
  for (const cmd of ['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']) {
    try {
      const r = spawnSync(cmd, ['-version'], { stdio: 'ignore' });
      if (r.status === 0) {
        ffmpegPath = cmd;
        return cmd;
      }
    } catch { /* try next */ }
  }

  // 3) Nothing found — highlights degrade gracefully (callers check
  //    isFfmpegAvailable() and captureClip() returns an error result).
  ffmpegPath = null;
  return null;
}

export function isFfmpegAvailable(): boolean {
  return detectFfmpeg() !== null;
}

function clipsDir(): string {
  return docsClipsDir();
}

export function startRollingBuffer(hlsUrl: string) {
  const ff = detectFfmpeg();
  if (!ff) return;
  if (recorder) stopRollingBuffer();
  const tmpFile = path.join(clipsDir(), `.buffer-${Date.now()}.ts`);
  const args = [
    '-y',
    '-loglevel', 'error',
    '-headers', 'Referer: https://www.tiktok.com/\\r\\n',
    '-i', hlsUrl,
    '-c', 'copy',
    '-f', 'mpegts',
    '-fflags', '+genpts',
    tmpFile,
  ];
  try {
    const proc = spawn(ff, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    proc.on('error', () => { recorder = null; });
    proc.on('exit', () => { recorder = null; });
    recorder = { proc, tmpFile, hlsUrl };
  } catch {
    recorder = null;
  }
}

export function stopRollingBuffer() {
  if (!recorder) return;
  try { recorder.proc.kill('SIGTERM'); } catch { /* ignore */ }
  try { if (fs.existsSync(recorder.tmpFile)) fs.unlinkSync(recorder.tmpFile); } catch { /* ignore */ }
  recorder = null;
}

export async function captureClip(reason: string, host: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  const ff = detectFfmpeg();
  if (!ff) return { ok: false, error: 'FFmpeg unavailable (bundled binary missing — reinstall the app, or install ffmpeg on PATH)' };
  if (!recorder) return { ok: false, error: 'No active stream buffer (need HLS URL from a connected room)' };

  const safeReason = reason.replace(/[^a-z0-9]/gi, '_').slice(0, 40);
  const safeHost = host.replace(/[^a-z0-9]/gi, '_').slice(0, 40);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(clipsDir(), `${safeHost}-${ts}-${safeReason}.mp4`);

  return new Promise((resolve) => {
    if (!recorder) {
      resolve({ ok: false, error: 'Buffer disappeared' });
      return;
    }
    if (!fs.existsSync(recorder.tmpFile)) {
      resolve({ ok: false, error: 'Buffer file missing' });
      return;
    }

    const args = [
      '-y', '-loglevel', 'error',
      '-sseof', `-${BUFFER_SECONDS}`,
      '-i', recorder.tmpFile,
      '-c', 'copy',
      outPath,
    ];
    const proc = spawn(ff, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('exit', (code) => {
      if (code === 0 && fs.existsSync(outPath)) {
        resolve({ ok: true, path: outPath });
      } else {
        resolve({ ok: false, error: stderr.slice(0, 200) || `ffmpeg exit ${code}` });
      }
    });
    proc.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

export function getClipsDir(): string {
  return clipsDir();
}

export function listClips(): { name: string; path: string; size: number; mtime: number }[] {
  try {
    const dir = clipsDir();
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.mp4'))
      .map((f) => {
        const p = path.join(dir, f);
        const s = fs.statSync(p);
        return { name: f, path: p, size: s.size, mtime: s.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}
