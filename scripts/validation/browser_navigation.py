"""Use the console's visible navigation, including its specialist disclosure."""
from playwright.sync_api import expect


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
