"""Bounded PDF renderer for already-escaped LiveLens report HTML; no network."""
import argparse
import sys
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--chromium', required=True)
args = parser.parse_args()
html = sys.stdin.buffer.read(4_194_305)
if len(html) > 4_194_304:
    raise ValueError('report_capacity')
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=args.chromium, headless=True)
    context = browser.new_context(java_script_enabled=False)
    context.route('**/*', lambda route: route.abort())
    page = context.new_page()
    page.set_content(html.decode('utf-8'), wait_until='load', timeout=8000)
    result = page.pdf(format='A4', print_background=True, margin={'top': '18mm', 'bottom': '18mm', 'left': '16mm', 'right': '16mm'})
    browser.close()
    sys.stdout.buffer.write(result)
