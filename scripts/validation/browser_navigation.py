"""Use the console's visible navigation, including its specialist disclosure."""
import hashlib
from playwright.sync_api import expect


def renderer_assets(page):
    """Record the actual authenticated JavaScript/CSS bytes used by a journey."""
    urls = page.evaluate("""() => [...new Set([
        ...[...document.querySelectorAll('script[src]')].map(element => element.src),
        ...[...document.querySelectorAll('link[rel="stylesheet"]')].map(element => element.href)
    ])].sort()""")
    assert urls, "The browser must load actual application assets"
    receipts = []
    for url in urls:
        response = page.request.get(url)
        assert response.status == 200, "The journey's renderer assets must remain available"
        receipts.append({"url": url, "sha256": hashlib.sha256(response.body()).hexdigest()})
    return receipts


def navigate(page, label, *, keyboard=False):
    navigation = page.get_by_role("navigation", name="LiveLens navigation")
    if not navigation.is_visible():
        page.get_by_role("button", name="Toggle navigation", exact=True).click()
        expect(navigation).to_be_visible()
        if keyboard:
            expect(navigation.locator('[aria-current="page"]')).to_be_focused()
    destination = navigation.get_by_role("button", name=label, exact=True)
    if not destination.is_visible():
        more = navigation.get_by_role("button", name="More tools", exact=True)
        if more.get_attribute("aria-expanded") != "true":
            more.click()
        expect(destination).to_be_visible()
    if keyboard:
        destination.focus()
        page.keyboard.press("Enter")
    else:
        destination.click()
