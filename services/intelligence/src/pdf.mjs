import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Fault, object } from './validation.mjs';

export function renderPdf(html, configuration) {
  object(configuration, ['python', 'chromium']);
  if (!isAbsolute(configuration.python) || !isAbsolute(configuration.chromium) || typeof html !== 'string' || Buffer.byteLength(html) > 4_194_304) throw new Fault('invalid_pdf_configuration');
  return new Promise((resolve, reject) => {
    const child = spawn(configuration.python, [fileURLToPath(new URL('../scripts/pdf-export.py', import.meta.url)), '--chromium', configuration.chromium], { stdio: ['pipe', 'pipe', 'ignore'], detached: true });
    let bytes = 0, finished = false; const chunks = [];
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const finish = error => { if (finished) return; finished = true; clearTimeout(timer); if (error) { kill(); reject(error); } else resolve(Buffer.concat(chunks)); };
    const timer = setTimeout(() => finish(new Fault('pdf_render_timeout', 503)), 12_000);
    child.on('error', () => finish(new Fault('pdf_renderer_unavailable', 503)));
    child.stdout.on('data', part => { bytes += part.length; if (bytes > 12_582_912) finish(new Fault('pdf_export_capacity', 409)); else chunks.push(part); });
    child.on('exit', code => { if (code || !bytes || !Buffer.concat(chunks).subarray(0, 5).equals(Buffer.from('%PDF-'))) finish(new Fault('pdf_render_failed', 503)); else finish(); });
    child.stdin.on('error', () => {}); child.stdin.end(html);
  });
}
