"""Exercise the Aperture investigation desk against a real, isolated service.

Build the console first. All statements are labelled synthetic fixtures. The
journey creates no external capture and fabricates no successful responses or
permission decisions. Two dropped browser responses exercise recovery after an
actual committed write. Its temporary database is deleted after a real restart;
screenshots, downloaded report and an executed-check receipt remain in /tmp.
"""
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from urllib.parse import urlsplit
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright
from browser_navigation import navigate, renderer_assets

ROOT = Path(__file__).resolve().parents[2]
with socket.socket() as reservation:
    reservation.bind(("127.0.0.1", 0))
    PORT = reservation.getsockname()[1]
BASE = f"http://127.0.0.1:{PORT}"
SCREENSHOTS = Path(os.environ.get("LIVELENS_SCREENSHOTS_DIR") or tempfile.mkdtemp(prefix="livelens-investigation-desk-"))
SCREENSHOTS.mkdir(parents=True, exist_ok=True)
CASE_TITLE = "Fictional archive context investigation"
REPORT_TITLE = "Reviewed fictional archive brief"


@contextmanager
def browser_diagnostics():
    state = {"page": None}
    try:
        yield state
    except Exception:
        if state["page"] is not None:
            try:
                state["page"].screenshot(path=str(SCREENSHOTS / "failure.png"), full_page=True)
                (SCREENSHOTS / "failure-state.txt").write_text(state["page"].locator("body").inner_text())
            except Exception:
                pass
        raise


def stop(child):
    if child is None or child.poll() is not None:
        return
    child.terminate()
    try:
        child.wait(timeout=10)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=5)


def launch(directory):
    """Two actual browser principals let authority change during a selection."""
    entry = Path(directory) / "investigation-fixture.mjs"
    imports = {name: (ROOT / f"services/intelligence/src/{name}.mjs").as_uri()
               for name in ["store", "server", "investigations", "governance", "recorder"]}
    entry.write_text(f'''import {{ randomBytes }} from "node:crypto";
import {{ resolve }} from "node:path";
import {{ EvidenceStore }} from {json.dumps(imports["store"])};
import {{ createIntelligenceServer, SCOPES }} from {json.dumps(imports["server"])};
import {{ InvestigationEngine }} from {json.dumps(imports["investigations"])};
import {{ Governance }} from {json.dumps(imports["governance"])};
import {{ Recorder }} from {json.dumps(imports["recorder"])};
const directory = process.env.LIVELENS_DEMO_DIR;
const store = new EvidenceStore(resolve(directory, "evidence.sqlite"));
const recorder = new Recorder({{ store, mediaRoot: resolve(directory, "media"), sources: [], ffmpeg: "/usr/bin/ffmpeg" }});
const investigation = new InvestigationEngine({{ store }});
const governance = new Governance({{ store, recorder, members: [
  {{workspace: "fixture_workspace", subject: "fixture-owner", role: "owner"}},
  {{workspace: "fixture_workspace", subject: "fixture-analyst", role: "analyst"}}
] }});
const users = ["fixture-owner", "fixture-analyst"].map(username => ({{username, password: "fixture-operator-only", workspace: "fixture_workspace", scopes: SCOPES}}));
const server = createIntelligenceServer({{ store, recorder, investigation, governance,
  keys: [{{token: randomBytes(32).toString("base64url"), workspace: "fixture_workspace", subject: "fixture-owner", scopes: SCOPES}}],
  browser: {{origin: "http://127.0.0.1:" + process.env.LIVELENS_PORT, bundleDir: {json.dumps(str(ROOT / "dist"))}, users}}
}});
server.listen(Number(process.env.LIVELENS_PORT), "127.0.0.1");
const close = () => server.close(async () => {{ await recorder.close(); store.close(); process.exit(0); }});
process.once("SIGTERM", close); process.once("SIGINT", close);
''')
    env = {**os.environ, "LIVELENS_DEMO_DIR": str(directory), "LIVELENS_PORT": str(PORT)}
    with (SCREENSHOTS / "fixture-server.log").open("ab") as log:
        child = subprocess.Popen(["node", str(entry)], cwd=ROOT, env=env, stdout=log, stderr=log)
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError("Investigation fixture exited; inspect fixture-server.log")
        try:
            with urlopen(BASE + "/health", timeout=1) as response:
                if response.status == 200:
                    return child
        except OSError:
            pass
        time.sleep(.1)
    stop(child)
    raise RuntimeError("Investigation fixture did not become ready")


def main():
    server = None
    page = None
    with tempfile.TemporaryDirectory(prefix="livelens-investigation-desk-data-") as directory:
        try:
            server = launch(directory)
            with sync_playwright() as playwright, browser_diagnostics() as diagnostics:
                browser = playwright.chromium.launch(executable_path=os.environ.get("LIVELENS_CHROMIUM", "/usr/bin/chromium"), headless=True)
                context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
                page = context.new_page()
                diagnostics["page"] = page
                page.set_default_timeout(15000)
                errors = []
                duplicate_key_warnings = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("console", lambda message: duplicate_key_warnings.append(message.text)
                        if "same key" in message.text.lower() or 'unique "key"' in message.text.lower() else None)
                owner = playwright.request.new_context(base_url=BASE, extra_http_headers={"Origin": BASE})
                authenticated = owner.post("/console/login", data={"username": "fixture-owner", "password": "fixture-operator-only"})
                assert authenticated.status == 200, authenticated.text()
                owner_csrf = authenticated.json()["csrf"]

                def write(path, value, expected=201, client=None, csrf=None):
                    response = (client or owner).post(BASE + path, data=value, headers={"Origin": BASE, "X-LiveLens-CSRF": csrf or owner_csrf})
                    assert response.status == expected, f"{path}: {response.status} {response.text()}"
                    return response.json()

                def read(path, client=None):
                    response = (client or owner).get(BASE + path)
                    assert response.status == 200, f"{path}: {response.status} {response.text()}"
                    return response.json()

                def login():
                    page.goto(BASE + "/app/", wait_until="networkidle")
                    page.get_by_label("Operator name", exact=True).fill("fixture-analyst")
                    page.get_by_label("Password", exact=True).fill("fixture-operator-only")
                    with page.expect_response(lambda response: urlsplit(response.url).path == "/console/login" and response.request.method == "POST") as response:
                        page.get_by_role("button", name="Open workspace", exact=True).click()
                    assert response.value.status == 200
                    expect(page.get_by_role("heading", name="Live monitor", exact=True)).to_be_visible()
                    return response.value.json()["csrf"]

                captures = []
                layouts = {}

                def capture(name, *, full_page=True, anchor=None):
                    if anchor:
                        page.locator(anchor).evaluate("element => window.scrollTo(0, element.getBoundingClientRect().top + scrollY - 80)")
                    else:
                        page.evaluate("window.scrollTo(0, 0)")
                    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
                    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Document overflow: {name}"
                    layouts[name] = page.evaluate("""() => ({width: innerWidth, height: innerHeight, scrollHeight: document.documentElement.scrollHeight,
                        footerBottom: Math.ceil(document.querySelector('.ll-footer')?.getBoundingClientRect().bottom + scrollY),
                        appBottom: Math.ceil(document.querySelector('.ll-app')?.getBoundingClientRect().bottom + scrollY),
                        bodyHeight: document.body.getBoundingClientRect().height, mainHeight: document.querySelector('#ll-main')?.getBoundingClientRect().height,
                        hidden: [...document.querySelectorAll('[hidden]')].map(e => ({tag: e.tagName, classes: e.className, display: getComputedStyle(e).display, height: e.getBoundingClientRect().height})),
                        furthest: [...document.body.querySelectorAll('*')].filter(e => e.getClientRects().length).map(e => ({tag:e.tagName, classes:typeof e.className === 'string' ? e.className : '', bottom:e.getBoundingClientRect().bottom + scrollY, height:e.getBoundingClientRect().height, position:getComputedStyle(e).position})).sort((a,b)=>b.bottom-a.bottom).slice(0,8)
                    })""")
                    geometry = layouts[name]
                    assert geometry["scrollHeight"] <= max(geometry["height"], geometry["footerBottom"], geometry["appBottom"]) + 4, f"Blank document overflow below application: {name}: {geometry}"
                    page.screenshot(path=str(SCREENSHOTS / name), full_page=full_page and not page.locator("dialog[open]").count())
                    layouts[name]["scrollHeightAfterCapture"] = page.evaluate("document.documentElement.scrollHeight")
                    (SCREENSHOTS / "layout-receipt.json").write_text(json.dumps(layouts, indent=2))
                    captures.append(name)

                def section(label):
                    return page.locator('[aria-label="Investigation sections"]').get_by_role("button", name=label, exact=True)

                def choose(evidence):
                    choice = page.get_by_role("checkbox", name="Select source: " + evidence["text"][:70], exact=True)
                    expect(choice).to_be_visible()
                    choice.focus()
                    page.keyboard.press("Space")
                    expect(choice).to_be_checked()

                # Retain more records than one UI page, including an old source
                # and saved label which initial result pages cannot contain.
                started = 1792108800000
                for session_id, title, account in [
                    ("archive-fixture", "Aperture archive fixture", "fictional_archive"),
                    ("witness-fixture", "Aperture witness fixture", "fictional_witness"),
                ]:
                    write("/v1/sessions", {"id": session_id, "platform": "fixture", "account": account,
                          "sourceUrl": "https://example.invalid/" + session_id, "title": title, "startedAtMs": started})
                events = [{"source": {"adapter": "investigation-fixture", "eventId": f"archive-{index}"},
                           "kind": "chat" if index % 2 == 0 else "caption",
                           "text": f"Aperture fixture source {index:03}: " + ("older retrieval needle." if index == 0 else "fictional context for review."),
                           "account": "fictional_archive" if index % 2 == 0 else None,
                           "sourceTimestampMs": None, "capturedAtMs": started + index * 1000,
                           "raw": {"fixture": True}} for index in range(150)]
                write("/v1/sessions/archive-fixture/events", {"events": events}, expected=200)
                witness_text = "Fictional witness: a nearby statement challenges the interpretation."
                write("/v1/sessions/witness-fixture/events", {"events": [{
                    "source": {"adapter": "investigation-fixture", "eventId": "witness-1"}, "kind": "chat", "text": witness_text,
                    "account": "fictional_witness", "sourceTimestampMs": None, "capturedAtMs": started + 300000,
                    "raw": {"fixture": True}}]}, expected=200)
                archive = read("/v1/sessions/archive-fixture/events?limit=200")["events"]
                witness = read("/v1/sessions/witness-fixture/events")["events"][0]
                assert len(archive) == 150
                for index in range(65):
                    write("/v1/bookmarks", {"evidenceId": archive[index]["id"], "label": "Saved retrieval target" if index == 10 else f"Saved archive fixture {index:03}"})
                initial_saved = read("/v1/bookmarks?limit=50")
                assert initial_saved["hasMore"] and not any(item["label"] == "Saved retrieval target" for item in initial_saved["bookmarks"])
                write("/v1/bookmarks", {"evidenceId": archive[10]["id"], "label": "Saved retrieval target alternate label"})
                destination = write("/v1/cases", {"title": "Aperture deep archive destination", "question": "Can an older accessible case be found before pagination?"})
                readonly = write("/v1/cases", {"title": "Fictional restricted read-only case", "question": "Can a reader inspect without adding evidence?"})
                write(f"/v1/workspace/cases/{readonly['id']}/access", {"visibility": "restricted", "subject": "fixture-analyst", "permission": "read", "reason": "Explicit read-only fixture grant."})
                for index in range(55):
                    write("/v1/cases", {"title": f"Fictional library filler {index:03}", "question": "Labelled fixture for accessible case pagination."})
                assert destination["id"] not in {item["id"] for item in read("/v1/cases?limit=50")["cases"]}

                csrf = login()
                navigate(page, "Session library", keyboard=True)
                library = page.get_by_role("region", name="Conversation and recording library", exact=True)
                library.get_by_label("Filter session library", exact=True).fill("Aperture witness fixture")
                expect(library.locator(".rl-row")).to_have_count(1)
                library.locator(".rl-row").focus()
                page.keyboard.press("Enter")
                timeline = page.get_by_role("region", name="Captured timeline", exact=True)
                timeline.get_by_role("button", name=re.compile("Fictional witness:")).click()
                expect(page.locator(".ll-context .ll-id")).to_have_text(witness["id"])
                page.get_by_role("button", name="Add to investigation", exact=True).click()
                picker = page.get_by_role("dialog", name="Add evidence to investigation", exact=True)
                expect(picker).to_be_visible()
                picker.get_by_label("Find an investigation", exact=True).fill(readonly["title"])
                expect(picker.get_by_role("radio", name=re.compile(re.escape(readonly["title"])))).to_be_disabled()
                picker.get_by_role("button", name="New investigation", exact=True).click()
                picker.get_by_label("Investigation name", exact=True).fill(CASE_TITLE)
                picker.get_by_label("Question", exact=True).fill("What do the fictional archive and conflicting witness support?")
                capture("01-desktop-create-from-conversation.png")
                committed_creations = []
                dropped_recovery = []

                def drop_committed_creation(route):
                    if route.request.method == "POST" and not committed_creations:
                        response = route.fetch()
                        assert response.status == 201, response.text()
                        committed_creations.append(response.json())
                        route.abort("failed")
                    else:
                        route.continue_()

                def drop_first_recovery(route):
                    if not dropped_recovery:
                        dropped_recovery.append(route.request.url)
                        route.abort("failed")
                    else:
                        route.continue_()

                page.route(BASE + "/v1/cases", drop_committed_creation)
                page.route(BASE + "/v1/cases/*/report", drop_first_recovery)
                picker.get_by_role("button", name="Create with evidence", exact=True).focus()
                page.keyboard.press("Enter")
                expect(picker.get_by_role("alert")).to_be_visible()
                assert len(committed_creations) == len(dropped_recovery) == 1
                expect(picker.get_by_label("Investigation name", exact=True)).to_have_value(CASE_TITLE)
                expect(picker.get_by_label("Investigation name", exact=True)).to_be_disabled()
                assert len(read("/v1/cases?q=Fictional%20archive%20context%20investigation")["cases"]) == 1
                with page.expect_response(lambda response: urlsplit(response.url).path == "/v1/cases" and response.request.method == "POST") as retry:
                    picker.get_by_role("button", name="Create with evidence", exact=True).click()
                assert retry.value.status == 409, retry.value.text()
                expect(picker.get_by_role("button", name="Open investigation", exact=True)).to_be_visible()
                page.unroute(BASE + "/v1/cases", drop_committed_creation)
                page.unroute(BASE + "/v1/cases/*/report", drop_first_recovery)
                case = committed_creations[0]
                case_id = case["id"]
                assert [item["id"] for item in read("/v1/cases?q=Fictional%20archive%20context%20investigation")["cases"]] == [case_id], "Lost-response retry must recover the same single investigation"
                initial = read(f"/v1/investigations/{case_id}")
                assert [item["id"] for item in initial["evidence"]] == [witness["id"]], "Case creation must already include the selected original"
                picker.get_by_role("button", name="Open investigation", exact=True).click()
                expect(page.get_by_role("heading", name=CASE_TITLE, exact=True)).to_be_visible()

                section("Gather evidence").click()
                search = page.get_by_label("Search retained evidence", exact=True)
                search.fill("Aperture fixture source")
                first = read("/v1/evidence/search?q=Aperture%20fixture%20source&limit=50&offset=0")
                second = read("/v1/evidence/search?q=Aperture%20fixture%20source&limit=50&offset=50")
                assert first["hasMore"] and second["hasMore"] and len(first["evidence"]) == 50
                assert archive[0]["id"] not in {item["id"] for item in first["evidence"]}
                source_a, source_b = first["evidence"][0], second["evidence"][0]
                choose(source_a)
                page.get_by_role("button", name="Next evidence page", exact=True).focus()
                page.keyboard.press("Enter")
                choose(source_b)
                search.fill("older retrieval needle")
                page.get_by_label("Evidence kind", exact=True).select_option("chat")
                choose(archive[0])
                page.get_by_role("button", name="Saved moments", exact=True).click()
                search.fill("Saved retrieval target")
                duplicate_choices = page.get_by_role("checkbox", name="Select source: " + archive[10]["text"][:70], exact=True)
                expect(duplicate_choices).to_have_count(2)
                duplicate_choices.first.check()
                expect(duplicate_choices.last).to_be_checked()
                duplicate_choices.last.uncheck()
                expect(duplicate_choices.first).not_to_be_checked()
                duplicate_choices.first.check()
                page.get_by_role("button", name="All retained evidence", exact=True).click()
                page.get_by_role("button", name="Saved moments", exact=True).click()
                expect(duplicate_choices.first).to_be_checked()
                expect(duplicate_choices.last).to_be_checked()
                batch = page.get_by_role("button", name="Add 4 sources to investigation", exact=True)
                expect(batch).to_be_enabled()
                page.get_by_role("complementary", name="Selected evidence", exact=True).get_by_role("button", name="Open original", exact=True).first.click()
                expect(page.locator(".ll-context .ll-id")).to_have_text(source_a["id"])
                page.get_by_role("button", name="Return to investigation", exact=True).click()
                expect(batch).to_be_enabled()
                expect(search).to_have_value("Saved retrieval target")
                expect(page.get_by_role("button", name="Saved moments", exact=True)).to_have_attribute("aria-pressed", "true")
                capture("02-desktop-gather-across-pages.png")
                capture("02a-desktop-gather-viewport.png", full_page=False, anchor=".id-case-heading")

                # The analyst retains pending selections when the real server
                # refuses a permission lost after the last capability read.
                write("/v1/workspace/members", {"subject": "fixture-analyst", "role": "viewer"})
                with page.expect_response(lambda response: urlsplit(response.url).path == f"/v1/cases/{case_id}/evidence" and response.request.method == "POST") as denied:
                    batch.click()
                assert denied.value.status == 403
                expect(batch).to_be_visible()
                assert len(read(f"/v1/investigations/{case_id}")["evidence"]) == 1
                capture("03-desktop-permission-selection-retained.png")
                write("/v1/workspace/members", {"subject": "fixture-analyst", "role": "analyst"})
                # A concurrent operator adds one selected source. Retrying must
                # safely deduplicate it within the same atomic batch request.
                write(f"/v1/cases/{case_id}/evidence", {"evidenceIds": [source_a["id"]]}, expected=200)
                with page.expect_response(lambda response: urlsplit(response.url).path == f"/v1/cases/{case_id}/evidence" and response.request.method == "POST") as linked:
                    batch.focus()
                    page.keyboard.press("Enter")
                assert linked.value.status == 200
                link_receipt = linked.value.json()
                assert link_receipt["linked"] == 3 and link_receipt["existing"] == 1 and link_receipt["total"] == 5, link_receipt
                expect(batch).to_have_count(0)
                expected_ids = {witness["id"], source_a["id"], source_b["id"], archive[0]["id"], archive[10]["id"]}
                detail = read(f"/v1/investigations/{case_id}")
                assert {item["id"] for item in detail["evidence"]} == expected_ids

                # A retained tray is bounded independently of the result page.
                page.get_by_role("button", name="All retained evidence", exact=True).click()
                search.fill("Aperture fixture source")
                page.get_by_label("Evidence kind", exact=True).select_option("all")
                results = page.get_by_role("region", name="Find investigation evidence", exact=True)
                expect(results.get_by_role("checkbox")).to_have_count(50)
                for checkbox in results.get_by_role("checkbox").all():
                    if checkbox.is_enabled():
                        checkbox.check()
                page.get_by_role("button", name="Next evidence page", exact=True).click()
                next_choice = next(item for item in second["evidence"] if item["id"] not in expected_ids)
                choose(next_choice)
                expect(page.get_by_role("button", name="Add 50 sources to investigation", exact=True)).to_be_enabled()
                expect(page.get_by_text("Selection limit reached. Add this set, then gather more.", exact=True)).to_be_visible()
                assert not results.locator('input[type="checkbox"]:not(:checked):enabled').count(), "A 51st distinct source must not be selectable"
                page.get_by_role("button", name="Clear selection", exact=True).click()
                expect(page.get_by_role("button", name="Add 0 sources to investigation", exact=True)).to_be_disabled()
                assert {item["id"] for item in read(f"/v1/investigations/{case_id}")["evidence"]} == expected_ids

                section("Evidence & notes").click()
                page.get_by_label("Select evidence: " + source_a["text"][:70], exact=True).check()
                note_text = "Synthetic archive review: retain the conflicting witness and exact original statements."
                page.get_by_label("Add a note", exact=True).fill(note_text)
                page.get_by_role("button", name="Open original context", exact=True).first.click()
                expect(page.get_by_role("heading", name="Evidence & context", exact=True)).to_be_visible()
                page.get_by_role("button", name="Return to investigation", exact=True).click()
                expect(section("Evidence & notes")).to_have_attribute("aria-pressed", "true")
                expect(page.get_by_role("textbox", name="Add a note", exact=True)).to_have_value(note_text)
                expect(page.get_by_role("checkbox", name="Select evidence: " + source_a["text"][:70], exact=True)).to_be_checked()
                page.get_by_role("button", name="Save note", exact=True).click()
                expect(page.get_by_text("Note saved with its evidence references.", exact=True)).to_be_visible()
                section("Findings & review").click()
                page.get_by_label("Finding title", exact=True).fill("Fictional context remains unresolved")
                page.get_by_label("Interpretation", exact=True).fill("The synthetic archive supplies a statement; a fictional witness challenges the interpretation. No external event is established.")
                page.get_by_label("Supports finding: " + source_a["text"][:60], exact=True).check()
                page.get_by_label("Challenges finding: " + witness["text"][:60], exact=True).check()
                page.get_by_role("button", name="Save draft finding", exact=True).click()
                expect(page.get_by_text("Draft finding saved for review.", exact=True)).to_be_visible()
                page.get_by_text("Review or correct this finding", exact=True).click()
                page.get_by_label("Reason for this decision", exact=True).fill("Checked both retained fictional originals; uncertainty remains explicit.")
                page.get_by_role("button", name="Mark reviewed", exact=True).click()
                expect(page.get_by_text("2 retained revisions", exact=True)).to_be_visible()
                capture("04-desktop-reviewed-finding.png")

                page.locator(".aw-finding-sources").get_by_role("button", name="Source 1", exact=True).first.click()
                expect(page.get_by_role("heading", name="Evidence & context", exact=True)).to_be_visible()
                original_id = page.locator(".ll-context .ll-id").inner_text()
                assert original_id in expected_ids
                original = read("/v1/evidence/" + original_id)
                expect(page.locator(".ll-context blockquote")).to_have_text(original["text"])
                page.get_by_role("button", name="Return to investigation", exact=True).focus()
                page.keyboard.press("Enter")
                expect(page.get_by_role("heading", name=CASE_TITLE, exact=True)).to_be_visible()
                section("Report editor").click()
                summary_text = "Reviewed fictional statements and conflicting context remain source linked. This fixture establishes no external claims."
                page.get_by_label("Report title", exact=True).fill(REPORT_TITLE)
                page.get_by_role("textbox", name="Executive summary", exact=True).fill(summary_text)
                redacted_choice = page.get_by_role("checkbox", name="Select evidence: " + witness["text"][:70], exact=True)
                redacted_choice.check()
                page.get_by_role("button", name="Open original context", exact=True).first.click()
                expect(page.locator(".ll-context .ll-id")).to_have_text(witness["id"])
                with page.expect_response(lambda response: urlsplit(response.url).path == "/v1/bookmarks" and response.request.method == "POST") as saved_during_draft:
                    page.get_by_role("button", name="Bookmark evidence", exact=True).click()
                assert saved_during_draft.value.status == 201
                page.get_by_role("button", name="Return to investigation", exact=True).click()
                expect(section("Report editor")).to_have_attribute("aria-pressed", "true")
                expect(page.get_by_role("textbox", name="Report title", exact=True)).to_have_value(REPORT_TITLE)
                expect(page.get_by_role("textbox", name="Executive summary", exact=True)).to_have_value(summary_text)
                expect(redacted_choice).to_be_checked()
                with page.expect_response(lambda response: urlsplit(response.url).path == f"/v1/investigations/{case_id}/report" and response.request.method == "GET") as refreshed_draft:
                    page.get_by_role("button", name="Refresh records", exact=True).click()
                assert refreshed_draft.value.status == 200
                expect(page.get_by_role("textbox", name="Report title", exact=True)).to_have_value(REPORT_TITLE)
                expect(page.get_by_role("textbox", name="Executive summary", exact=True)).to_have_value(summary_text)
                expect(redacted_choice).to_be_checked()

                # Another actual operator changes the persisted report while
                # this browser has a dirty draft. Refresh cannot silently adopt
                # the newer revision or discard the operator's unsaved work.
                current_editor = read(f"/v1/investigations/{case_id}/report")
                write(f"/v1/investigations/{case_id}/report", {
                    "title": "Concurrent fictional owner revision", "summary": "A separate operator saved this revision.",
                    "redactions": [], "reason": "Exercise real revision conflict without a mocked response.",
                    "expectedRevision": current_editor["revision"]})
                with page.expect_response(lambda response: urlsplit(response.url).path == f"/v1/investigations/{case_id}/report" and response.request.method == "GET") as concurrent_read:
                    page.get_by_role("button", name="Refresh records", exact=True).click()
                assert concurrent_read.value.status == 200 and concurrent_read.value.json()["title"] == "Concurrent fictional owner revision"
                page.get_by_label("Revision reason", exact=True).fill("Attempt to save the retained local draft.")
                with page.expect_response(lambda response: urlsplit(response.url).path == f"/v1/investigations/{case_id}/report" and response.request.method == "POST") as stale_save:
                    page.get_by_role("button", name="Save report revision", exact=True).click()
                assert stale_save.value.status == 409
                expect(page.get_by_role("textbox", name="Report title", exact=True)).to_have_value(REPORT_TITLE)
                expect(page.get_by_role("textbox", name="Executive summary", exact=True)).to_have_value(summary_text)
                expect(redacted_choice).to_be_checked()
                capture("05a-desktop-draft-conflict-preserved.png")
                page.get_by_role("button", name="Discard changes and reload", exact=True).click()
                expect(page.get_by_role("textbox", name="Report title", exact=True)).to_have_value("Concurrent fictional owner revision")
                expect(redacted_choice).not_to_be_checked()
                page.get_by_label("Report title", exact=True).fill(REPORT_TITLE)
                page.get_by_role("textbox", name="Executive summary", exact=True).fill(summary_text)
                redacted_choice.check()
                page.get_by_label("Revision reason", exact=True).fill("Prepare the reviewed fictional investigation brief.")
                page.get_by_role("button", name="Save report revision", exact=True).click()
                expect(page.get_by_text("Report revision saved.", exact=False)).to_be_visible()
                with page.expect_download() as download:
                    page.get_by_role("button", name=re.compile("Evidence bundle")).click()
                report = json.loads(Path(download.value.path()).read_text())
                assert {item["id"] for item in report["evidence"]} == expected_ids
                assert report["findings"][0]["status"] == "reviewed"
                assert report["findings"][0]["supportEvidenceIds"] == [source_a["id"]]
                assert report["findings"][0]["counterEvidenceIds"] == [witness["id"]]
                assert report["notes"][0]["evidenceIds"] == [source_a["id"]]
                assert next(item for item in report["evidence"] if item["id"] == witness["id"])["text"] == "[Text redacted in this report copy]"
                assert read("/v1/evidence/" + witness["id"])["text"] == witness_text
                (SCREENSHOTS / "reviewed-fixture-report.json").write_text(json.dumps(report, indent=2))
                capture("05-desktop-reviewed-brief.png")

                # The review's 200-source bound is visible and enforced by the
                # UI against an actually populated case, not an invented count.
                extra_events = [{"source": {"adapter": "investigation-fixture", "eventId": f"capacity-{index}"},
                                 "kind": "chat", "text": "Capacity overflow sentinel" if index == 49 else f"Capacity fixture original {index:03}",
                                 "sourceTimestampMs": None, "capturedAtMs": started + 400000 + index,
                                 "raw": {"fixture": True}} for index in range(50)]
                write("/v1/sessions/witness-fixture/events", {"events": extra_events}, expected=200)
                extra = read("/v1/evidence/search?q=Capacity&limit=100")["evidence"]
                sentinel = next(item for item in extra if item["text"] == "Capacity overflow sentinel")
                capacity_ids = [item["id"] for item in archive] + [witness["id"]] + [item["id"] for item in extra if item["id"] != sentinel["id"]]
                assert len(set(capacity_ids)) == 200
                capacity_case = write("/v1/cases", {"title": "Fictional full review capacity", "question": "Does the desk explain its actual bounded review capacity?", "evidenceIds": capacity_ids})
                page.get_by_role("button", name="All investigations", exact=True).click()
                page.get_by_label("Search investigations", exact=True).fill(capacity_case["title"])
                page.get_by_role("button", name=re.compile(re.escape(capacity_case["title"]))).click()
                section("Gather evidence").click()
                page.get_by_label("Search retained evidence", exact=True).fill(sentinel["text"])
                expect(page.get_by_role("checkbox", name="Select source: " + sentinel["text"], exact=True)).to_be_disabled()
                expect(page.get_by_text("This review holds 200 sources. Start another investigation to gather more.", exact=True)).to_be_visible()
                assert read(f"/v1/investigations/{capacity_case['id']}")["totalEvidence"] == 200
                capture("05b-desktop-full-review-capacity.png")
                page.get_by_role("button", name="All investigations", exact=True).click()
                page.get_by_label("Search investigations", exact=True).fill(CASE_TITLE)
                page.get_by_role("button", name=re.compile(re.escape(CASE_TITLE))).click()

                page.set_viewport_size({"width": 390, "height": 844})
                section("Gather evidence").click()
                search = page.get_by_label("Search retained evidence", exact=True)
                search.fill("Aperture fixture source")
                expect(page.get_by_role("checkbox", name=re.compile("^Select source:")).first).to_be_visible()
                preview = page.get_by_role("region", name="Find investigation evidence", exact=True).locator(".id-source-preview").first
                assert page.locator(".id-source-preview:not([open]) .id-provenance").evaluate_all("elements => elements.every(element => element.getBoundingClientRect().height === 0)"), "Collapsed source provenance must not contribute overflowing layout"
                capture("06-phone-gather.png")
                capture("06a-phone-gather-viewport.png", full_page=False, anchor=".id-source-browser")
                preview.locator("summary").click()
                expect(preview.locator(".id-provenance")).to_be_visible()
                assert preview.locator(".id-provenance").evaluate("element => element.getBoundingClientRect().height < 500"), "Source provenance must wrap legibly without a one-letter-wide column"
                capture("06b-phone-original-provenance.png", full_page=False, anchor=".id-source-browser")
                preview.locator("summary").click()
                section("Findings & review").click()
                expect(page.get_by_text("2 retained revisions", exact=True)).to_be_visible()
                capture("07-phone-reviewed-finding.png")
                section("Report editor").click()
                expect(page.get_by_label("Report title", exact=True)).to_have_value(REPORT_TITLE)
                capture("08-phone-reviewed-brief.png")

                # Open exact source then search an older case in the dialog.
                page.get_by_role("button", name="Open original context", exact=True).first.click()
                original_id = page.locator(".ll-context .ll-id").inner_text()
                page.get_by_role("button", name="Add to investigation", exact=True).click()
                expect(picker).to_be_visible()
                picker.get_by_label("Find an investigation", exact=True).fill("Aperture deep archive destination")
                radio = picker.get_by_role("radio", name=re.compile("Aperture deep archive destination"))
                expect(radio).to_be_visible()
                radio.focus()
                page.keyboard.press("Space")
                capture("09-phone-existing-investigation-picker.png")
                picker.get_by_role("button", name="Add evidence", exact=True).click()
                picker.get_by_role("button", name="Open investigation", exact=True).click()
                expect(page.get_by_role("heading", name=destination["title"], exact=True)).to_be_visible()
                assert [item["id"] for item in read(f"/v1/investigations/{destination['id']}")["evidence"]] == [original_id]

                # Real stop/start clears browser sessions; retained evidence,
                # notes, decisions and report revisions must survive unchanged.
                stop(server)
                server = launch(directory)
                context.clear_cookies()
                login()
                navigate(page, "Investigations", keyboard=True)
                page.get_by_label("Search investigations", exact=True).fill(CASE_TITLE)
                page.get_by_role("button", name=re.compile(re.escape(CASE_TITLE))).click()
                expect(page.get_by_role("heading", name=CASE_TITLE, exact=True)).to_be_visible()
                section("Findings & review").click()
                expect(page.get_by_text("2 retained revisions", exact=True)).to_be_visible()
                section("Report editor").click()
                expect(page.get_by_label("Report title", exact=True)).to_have_value(REPORT_TITLE)
                with page.expect_download() as reopened:
                    page.get_by_role("button", name=re.compile("Evidence bundle")).click()
                restored = json.loads(Path(reopened.value.path()).read_text())
                assert restored["evidence"] == report["evidence"]
                assert restored["notes"] == report["notes"]
                assert restored["findings"] == report["findings"]
                capture("10-phone-restarted-brief.png")
                assert not errors, errors
                assert not duplicate_key_warnings, duplicate_key_warnings
                receipt = {"fixture": True, "externalLiveValidated": False, "mockedSuccessResponses": False,
                           "controlledLostResponses": {"committedCreationPostDropped": 1, "firstRecoveryGetDropped": 1, "retryPostStatus": retry.value.status, "sameSingleInvestigationRecovered": True},
                           "createdWithEvidenceAtomicallyFromConversation": True,
                           "searchBeforePaginationAndExactKind": True,
                           "savedLabelSearchBeyondInitialPage": True,
                           "duplicateSavedLabelsShareOneOriginalSelection": True,
                           "selectionPersistsAcrossPagesAndFilters": True,
                           "sourceDetoursPreserveSelectionSearchAndUnsavedNote": True,
                           "dirtyReportSurvivesBookmarkDetourAndGlobalRefresh": True,
                           "concurrentReport409PreservesDraftUntilExplicitDiscard": True,
                           "reportRedactionPreservesOriginal": True,
                           "selectionBoundedTo50AndClearDoesNotWrite": True,
                           "actual200SourceReviewCapacityExplainedAndEnforced": True,
                           "readOnlyCaseCannotBeChosenInPicker": True,
                           "realPermissionFailurePreservesSelection": True,
                           "concurrentLinkDeduplication": link_receipt,
                           "sourceLinkedNoteAndReviewedCounterevidence": True,
                           "originalReopenedAndReturnedToInvestigation": True,
                           "existingOlderCaseSearchFromConversation": True,
                           "actualDownloadedReport": True, "serviceRestartRetainsReportEvidenceNotesAndFindings": True,
                           "desktopAnd390px": True, "keyboardSelectionNavigationAndDialog": True,
                           "collapsedAndExpandedSourceProvenanceHasNoDocumentOverflow": True,
                           "uncaughtPageErrors": len(errors), "duplicateKeyWarnings": len(duplicate_key_warnings), "rendererAssets": renderer_assets(page),
                           "screenshots": str(SCREENSHOTS), "captures": captures}
                (SCREENSHOTS / "receipt.json").write_text(json.dumps(receipt, indent=2))
                print(json.dumps(receipt))
                owner.dispose()
                browser.close()
        except Exception as error:
            if page is not None:
                try:
                    page.screenshot(path=str(SCREENSHOTS / "failure.png"), full_page=True)
                    (SCREENSHOTS / "failure-state.txt").write_text(page.locator("body").inner_text())
                except Exception:
                    pass
            (SCREENSHOTS / "failure-receipt.json").write_text(json.dumps({"fixture": True, "passed": False,
                "exception": type(error).__name__, "message": str(error)}, indent=2))
            print(f"Failure evidence: {SCREENSHOTS}", file=sys.stderr)
            raise
        finally:
            stop(server)


if __name__ == "__main__":
    main()
