"""Real loopback console acceptance using labelled fixtures, Chromium and FFmpeg."""
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
import traceback
from contextlib import contextmanager
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    PORT = sock.getsockname()[1]
BASE = f'http://127.0.0.1:{PORT}'
SCREENSHOTS = Path(os.environ.get('LIVELENS_SCREENSHOTS_DIR') or tempfile.mkdtemp(prefix='livelens-browser-receipt-'))
SCREENSHOTS.mkdir(parents=True, exist_ok=True)
failure_recorded = False

def record_failure(error, page=None):
    global failure_recorded
    if failure_recorded:
        return
    failure_recorded = True
    message = re.sub(r'(https?://[^\s?#]+)[?#][^\s]+', r'\1[query redacted]', str(error))
    message = re.sub(r'(?i)Bearer\s+[A-Za-z0-9._-]+', 'Bearer [redacted]', message)
    receipt = {'fixture': True, 'passed': False, 'exception': type(error).__name__, 'message': message}
    if page is not None:
        try:
            page.screenshot(path=str(SCREENSHOTS / 'failure.png'), full_page=True)
            (SCREENSHOTS / 'failure-state.txt').write_text(page.locator('body').inner_text())
            receipt['media'] = page.evaluate('''() => Array.from(document.querySelectorAll('video')).map(video => ({
                readyState: video.readyState, networkState: video.networkState,
                currentTime: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : null,
                paused: video.paused, error: video.error ? {code: video.error.code, message: video.error.message} : null,
                mp4Support: video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')
            }))''')
        except Exception as diagnostic_error:
            receipt['captureError'] = type(diagnostic_error).__name__
    (SCREENSHOTS / 'failure-receipt.json').write_text(json.dumps(receipt, indent=2))
    frames = [frame for frame in traceback.extract_tb(error.__traceback__) if Path(frame.filename).resolve() == Path(__file__).resolve()]
    location = f',line={frames[-1].lineno}' if frames else ''
    annotation = f'{type(error).__name__}: {message}'[:3000].replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
    print(f'::error file=scripts/validation/browser_smoke.py{location},title=Original browser journey::{annotation}', flush=True)
    print(f'Failure evidence: {SCREENSHOTS}', flush=True)

@contextmanager
def browser_diagnostics():
    state = {'page': None}
    try:
        yield state
    except Exception as error:
        record_failure(error, state['page'])
        raise

def ready(child):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError('Fixture exited before readiness; see fixture-server.log')
        try:
            with urlopen(BASE + '/health', timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            pass
        time.sleep(.1)
    raise RuntimeError('Fixture server did not become ready')

def launch(directory):
    env = {**os.environ, 'LIVELENS_DEMO_DIR': str(directory), 'LIVELENS_PORT': str(PORT)}
    with open(SCREENSHOTS / 'fixture-server.log', 'ab') as log:
        child = subprocess.Popen(['node', 'services/intelligence/scripts/console-demo.mjs'], cwd=ROOT, env=env, stdout=log, stderr=log)
    try:
        ready(child)
    except Exception:
        stop(child)
        raise
    return child

def stop(child):
    child.terminate()
    try:
        child.wait(timeout=10)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=5)

with tempfile.TemporaryDirectory(prefix='livelens-browser-data-') as directory:
    server = None
    try:
        server = launch(directory)
        with sync_playwright() as p, browser_diagnostics() as diagnostics:
            browser = p.chromium.launch(executable_path=os.environ.get('LIVELENS_CHROMIUM', '/usr/bin/chromium'), headless=True)
            page = browser.new_page(viewport={'width': 1440, 'height': 960}, accept_downloads=True)
            diagnostics['page'] = page
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))

            def login():
                page.goto(BASE + '/app/', wait_until='networkidle')
                page.get_by_label('Operator name').fill('fixture')
                page.get_by_label('Password', exact=True).fill('fixture-operator-only')
                page.get_by_role('button', name='Open workspace', exact=True).click()
                page.get_by_role('heading', name='Live monitor', exact=True).wait_for()

            login()
            page.get_by_role('link', name='Skip to content').focus()
            page.keyboard.press('Enter')
            assert page.evaluate('document.activeElement.id === "ll-main"')
            page.get_by_role('button', name='Cases & reports', exact=True).focus()
            page.keyboard.press('Enter')
            page.get_by_label('Case title').fill('Fixture browser investigation')
            page.get_by_label('Question to investigate').fill('Can the retained source be replayed after restart?')
            page.get_by_role('button', name='Create case', exact=True).click()
            page.get_by_text('Investigation created.', exact=True).wait_for()

            page.get_by_role('button', name='Sources & captures', exact=True).click()
            page.get_by_label('Maximum capture seconds').fill('8')
            page.get_by_role('button', name='Start bounded capture', exact=True).click()
            page.get_by_text('Capture queued.', exact=False).wait_for()
            for _ in range(40):
                page.get_by_role('button', name='Refresh capture state', exact=True).click()
                if page.get_by_text('recording', exact=True).count():
                    break
                page.wait_for_timeout(250)
            assert page.get_by_text('recording', exact=True).count(), page.locator('main').inner_text()
            page.get_by_role('button', name='Stop capture', exact=True).click()
            page.get_by_role('button', name='Replay conversation', exact=True).click()
            page.locator('video').wait_for()
            page.wait_for_function('() => document.querySelector("video").readyState >= 1')
            for _ in range(20):
                page.get_by_role('button', name='Refresh records', exact=True).click()
                if page.get_by_role('button', name='Synthetic fixture marker', exact=False).count():
                    break
                page.wait_for_timeout(250)
            page.get_by_role('button', name='Synthetic fixture marker', exact=False).first.click()
            page.wait_for_function('() => document.querySelector("video").currentTime >= 0.45')
            page.evaluate('async () => { const v = document.querySelector("video"); v.muted = true; await v.play(); }')
            page.wait_for_function('() => document.querySelector("video").currentTime > 0.8')
            page.evaluate('document.querySelector("video").pause()')
            page.get_by_label('Link to investigation').select_option(label='Fixture browser investigation')
            page.get_by_role('button', name='Link evidence', exact=True).click()
            page.get_by_text('Original evidence linked to case.', exact=True).wait_for()
            page.screenshot(path=str(SCREENSHOTS / 'desktop-replay.png'), full_page=True)

            page.get_by_role('button', name='Observed accounts', exact=True).click()
            page.get_by_label('Statement or phrase').fill('Synthetic fixture marker')
            page.get_by_label('Observed account').fill('fictional_viewer')
            page.get_by_role('button', name='Search captures', exact=True).click()
            page.get_by_role('button', name='Synthetic fixture marker', exact=False).first.wait_for()
            page.get_by_role('button', name='Cases & reports', exact=True).click()
            page.get_by_role('button', name='Fixture browser investigation', exact=False).click()
            page.get_by_role('button', name='Original evidence', exact=True).click()
            with page.expect_download() as download:
                page.get_by_role('button', name='Export JSON', exact=True).click()
            report = json.loads(Path(download.value.path()).read_text())
            assert report['evidence'] and report['media'][0]['segments']
            assert report['evidence'][0]['sourceTimestampMs'] is None
            with page.expect_download():
                page.get_by_role('button', name='Export Markdown', exact=True).click()

            page.set_viewport_size({'width': 390, 'height': 844})
            page.get_by_role('button', name='Toggle navigation', exact=True).click()
            page.get_by_role('button', name='Session library', exact=True).click()
            page.get_by_role('button', name='Fictional fixture', exact=False).click()
            page.get_by_role('heading', name='Captured timeline', exact=True).wait_for()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Phone overflow'
            page.screenshot(path=str(SCREENSHOTS / 'phone-replay.png'), full_page=True)

            stop(server)
            server = launch(directory)
            page.set_viewport_size({'width': 1440, 'height': 960})
            login()
            page.get_by_role('button', name='Cases & reports', exact=True).click()
            page.get_by_role('button', name='Fixture browser investigation', exact=False).click()
            page.get_by_role('button', name='Original evidence', exact=True).click()
            page.get_by_role('button', name='Synthetic fixture marker', exact=False).click()
            page.locator('video').wait_for()
            page.wait_for_function('() => document.querySelector("video").readyState >= 1')
            assert not errors, errors
            browser.close()
            receipt = {'fixture': True, 'desktopAndPhone': True, 'keyboardNavigation': True, 'recordingPlaybackAndSeek': True, 'accountSearch': True, 'caseAndBothExports': True, 'serviceRestartReopen': True, 'uncaughtPageErrors': len(errors), 'screenshots': str(SCREENSHOTS)}
            (SCREENSHOTS / 'receipt.json').write_text(json.dumps(receipt, indent=2))
            print(json.dumps(receipt))
    except Exception as error:
        record_failure(error)
        raise
    finally:
        if server is not None:
            stop(server)
