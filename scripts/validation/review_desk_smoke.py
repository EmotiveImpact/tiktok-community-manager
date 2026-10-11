"""Real review-desk journeys with fictional records and an isolated HTTP service.

Build the console first. The test records local FFmpeg footage, persists actual
findings/signals/schedules, then checks a separately configured read-only browser
identity against the same retained store. It contacts no external LIVE provider.
"""
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
from contextlib import contextmanager
from urllib.parse import parse_qs, urlsplit
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
with socket.socket() as reservation:
    reservation.bind(("127.0.0.1", 0))
    PORT = reservation.getsockname()[1]
BASE = f"http://127.0.0.1:{PORT}"
SCREENSHOTS = Path(os.environ.get("LIVELENS_SCREENSHOTS_DIR") or tempfile.mkdtemp(prefix="livelens-review-desk-"))
SCREENSHOTS.mkdir(parents=True, exist_ok=True)
FFMPEG = os.environ.get("LIVELENS_FFMPEG_PATH", "/usr/bin/ffmpeg")


def record_failure(error, page=None):
    message = re.sub(r'(https?://[^\s?#]+)[?#][^\s]+', r'\1[query redacted]', str(error))
    message = re.sub(r'(?i)Bearer\s+[A-Za-z0-9._-]+', 'Bearer [redacted]', message)
    if page is not None:
        try:
            page.screenshot(path=str(SCREENSHOTS / "failure.png"), full_page=True)
            (SCREENSHOTS / "failure-state.txt").write_text(page.locator("body").inner_text())
        except Exception:
            pass
    (SCREENSHOTS / "failure-receipt.json").write_text(json.dumps({"fixture": True, "passed": False, "exception": type(error).__name__, "message": message}, indent=2))


@contextmanager
def browser_diagnostics():
    state = {"page": None}
    try:
        yield state
    except Exception as error:
        record_failure(error, state["page"])
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


def launch(directory, readonly=False):
    env = {**os.environ, "LIVELENS_DEMO_DIR": str(directory), "LIVELENS_PORT": str(PORT), "LIVELENS_FFMPEG_PATH": FFMPEG}
    entry = ROOT / "services/intelligence/scripts/console-demo.mjs"
    if readonly:
        # This is a separate real server configuration, not a mocked capabilities
        # response or an edited demo. It opens the persisted fixture store with
        # a viewer membership and read scopes; no collection worker is started.
        entry = Path(directory) / "readonly-fixture.mjs"
        imports = {name: (ROOT / f"services/intelligence/src/{name}.mjs").as_uri() for name in ["store", "server", "recorder", "governance"]}
        entry.write_text(f'''import {{ randomBytes }} from "node:crypto";
import {{ resolve }} from "node:path";
import {{ EvidenceStore }} from {json.dumps(imports["store"])};
import {{ createIntelligenceServer }} from {json.dumps(imports["server"])};
import {{ Recorder }} from {json.dumps(imports["recorder"])};
import {{ Governance }} from {json.dumps(imports["governance"])};
const dir = process.env.LIVELENS_DEMO_DIR;
const store = new EvidenceStore(resolve(dir, "evidence.sqlite"));
const recorder = new Recorder({{ store, mediaRoot: resolve(dir, "media"), ffmpeg: process.env.LIVELENS_FFMPEG_PATH,
  sources: [{{ id: "fixture-media", workspace: "fixture_workspace", sessionId: "fixture-conversation", kind: "file", input: resolve(dir, "fixture-input.mp4"), label: "Synthetic colour bars & tone (fixture)" }}] }});
const governance = new Governance({{ store, recorder, members: [{{ workspace: "fixture_workspace", subject: "fixture-readonly", role: "viewer" }}] }});
const scopes = ["sessions:read", "evidence:read", "cases:read", "recordings:read", "workspace:read"];
const server = createIntelligenceServer({{ store, recorder, governance,
  keys: [{{ token: randomBytes(32).toString("base64url"), workspace: "fixture_workspace", subject: "fixture-readonly", scopes }}],
  browser: {{ origin: "http://127.0.0.1:" + process.env.LIVELENS_PORT, bundleDir: {json.dumps(str(ROOT / "dist"))},
    users: [{{ username: "fixture-readonly", password: "fixture-readonly-only", workspace: "fixture_workspace", scopes }}] }} }});
server.listen(Number(process.env.LIVELENS_PORT), "127.0.0.1");
const close = () => server.close(async () => {{ await recorder.close(); store.close(); process.exit(0); }});
process.once("SIGTERM", close); process.once("SIGINT", close);
''')
    with open(SCREENSHOTS / "fixture-server.log", "ab") as log:
        child = subprocess.Popen(["node", str(entry)], cwd=ROOT, env=env, stdout=log, stderr=log)
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError("Fixture exited; inspect fixture-server.log")
        try:
            with urlopen(BASE + "/health", timeout=1) as response:
                if response.status == 200:
                    return child
        except OSError:
            pass
        time.sleep(.1)
    stop(child)
    raise RuntimeError("Fixture server did not become ready")


with tempfile.TemporaryDirectory(prefix="livelens-review-desk-data-") as directory:
    server = None
    page = None
    try:
        server = launch(directory)
        with sync_playwright() as playwright, browser_diagnostics() as diagnostics:
            browser = playwright.chromium.launch(executable_path=os.environ.get("LIVELENS_CHROMIUM", "/usr/bin/chromium"), headless=True)
            owner_context = browser.new_context(viewport={"width": 1440, "height": 1024})
            page = owner_context.new_page()
            diagnostics["page"] = page
            page.set_default_timeout(15000)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))

            def login(username="fixture", password="fixture-operator-only"):
                page.goto(BASE + "/app/", wait_until="networkidle")
                page.get_by_label("Operator name").fill(username)
                page.get_by_label("Password", exact=True).fill(password)
                with page.expect_response(lambda response: response.url.endswith("/console/login") and response.request.method == "POST") as authenticated:
                    page.get_by_role("button", name="Open workspace", exact=True).click()
                assert authenticated.value.status == 200
                page.get_by_role("heading", name="Your review desk", exact=True).wait_for()
                return authenticated.value.json()["csrf"]

            csrf = login()

            def write(path, payload, expected=201):
                response = page.request.post(BASE + path, data=payload, headers={"Origin": BASE, "x-livelens-csrf": csrf})
                assert response.status == expected, f"Fixture write {path}: {response.status} {response.text()}"
                return response.json()

            def read(path):
                response = page.request.get(BASE + path)
                assert response.status == 200, f"Fixture read {path}: {response.status}"
                return response.json()

            def nav(label):
                if page.viewport_size["width"] < 800:
                    page.get_by_role("button", name="Toggle navigation", exact=True).click()
                page.get_by_role("navigation", name="LiveLens navigation").get_by_role("button", name=label, exact=True).click()

            def capture(name):
                page.evaluate("window.scrollTo(0, 0)")
                page.wait_for_function('() => [...document.querySelectorAll("video")].filter(media => media.getClientRects().length).every(media => media.readyState >= 2 && !media.seeking)')
                page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Horizontal overflow: {name}"
                page.screenshot(path=str(SCREENSHOTS / name), full_page=True)

            def row(title):
                return page.locator(".ll-desk-item").filter(has=page.locator(".ll-desk-item-title", has_text=re.compile("^" + re.escape(title) + "$")))

            inspector = page.get_by_role("complementary", name="Selected source inspector")

            def exact_preview(evidence):
                expect(inspector.locator(".ll-desk-quote")).to_have_text(evidence["text"])
                expect(inspector.locator(".ll-desk-provenance").filter(has_text="Evidence " + evidence["id"])).to_have_count(1)

            # Actual local recording produces usable media and clock receipts.
            job = write("/v1/jobs", {"id": "review-desk-capture", "sourceId": "fixture-media", "sessionId": "fixture-conversation", "maxDurationSeconds": 8, "segmentSeconds": 2})
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                job = read("/v1/jobs/" + job["id"])
                (SCREENSHOTS / "recording-receipt.json").write_text(json.dumps(job, indent=2))
                if job["segments"] and job["segments"][0]["durationMs"] >= 1000:
                    break
                assert job["state"] != "failed", job.get("error")
                page.wait_for_timeout(200)
            assert job["segments"], "Actual fixture recording must write a verified segment"
            write("/v1/jobs/" + job["id"] + "/stop", {}, expected=200)
            while time.monotonic() < deadline:
                job = read("/v1/jobs/" + job["id"])
                if job["state"] == "stopped":
                    break
                assert job["state"] != "failed", job.get("error")
                page.wait_for_timeout(200)
            assert job["state"] == "stopped" and job["segments"], "Explicit stop must finalize retained fixture media"
            (SCREENSHOTS / "recording-receipt.json").write_text(json.dumps(job, indent=2))
            segment = job["segments"][0]
            statement = "Fictional review desk source: preserve context for @fictional_target."
            counter = "Fictional clarification: this is a test conversation, not an allegation."
            appended = write("/v1/sessions/fixture-conversation/events", {"events": [
                {"source": {"adapter": "review-desk-fixture", "eventId": "selected-source"}, "kind": "chat", "text": statement, "account": "fictional_viewer", "capturedAtMs": segment["startedAtMs"] + 500, "raw": {"fixture": True, "recordingJobId": job["id"]}},
                {"source": {"adapter": "review-desk-fixture", "eventId": "selected-counter"}, "kind": "caption", "text": counter, "capturedAtMs": segment["startedAtMs"] + 800, "raw": {"fixture": True}},
                {"source": {"adapter": "review-desk-fixture", "eventId": "selected-gap"}, "kind": "gap", "text": "Fictional capture gap; missing content remains unknown.", "capturedAtMs": segment["startedAtMs"] + 1000, "raw": {"fixture": True}},
                {"source": {"adapter": "review-desk-fixture", "eventId": "replacement-counter"}, "kind": "caption", "text": "Fictional replacement clarification: the source still needs human review.", "capturedAtMs": segment["startedAtMs"] + 1200, "raw": {"fixture": True}},
            ]}, expected=200)
            evidence = [result["evidence"] for result in appended["results"]]
            source, challenge = evidence[0], evidence[1]
            replacement = evidence[3]
            case = write("/v1/cases", {"id": "review-desk-case", "title": "Fixture review desk investigation", "question": "Does the selected original support this fictional interpretation?"})
            write("/v1/cases/" + case["id"] + "/evidence", {"evidenceIds": [source["id"], challenge["id"]]}, expected=200)
            finding = write("/v1/investigations/" + case["id"] + "/findings", {"title": "Source-linked fixture interpretation", "statement": "This fictional interpretation requires both the original and its clarification.", "supportEvidenceIds": [source["id"]], "counterEvidenceIds": [challenge["id"]]})
            other_case = write("/v1/cases", {"id": "review-desk-other", "title": "Other fixture investigation", "question": "Keep investigations separate."})
            write("/v1/cases/" + other_case["id"] + "/evidence", {"evidenceIds": [challenge["id"]]}, expected=200)
            write("/v1/investigations/" + other_case["id"] + "/findings", {"title": "Other fixture interpretation", "statement": "This belongs to another fictional investigation.", "supportEvidenceIds": [challenge["id"]]})
            mission = write("/v1/missions", {"id": "review-desk-mission", "title": "Fictional review desk mission", "protectedAccount": "fictional_target", "sessionIds": [source["sessionId"]], "rules": [{"label": "Fixture review desk source signal", "terms": ["desk", "@fictional_target"], "match": "all"}]})
            run = write("/v1/missions/" + mission["id"] + "/run", {})
            assert run["created"] == 1 and run["alerts"][0]["evidenceId"] == source["id"]
            alert = run["alerts"][0]
            page.get_by_role("button", name="Refresh records", exact=True).click()

            # Filter semantics distinguish reviewable findings/signals from ordinary evidence.
            tabs = page.get_by_role("tablist", name="Review inbox filters")
            tabs.get_by_role("tab", name=re.compile("^Needs review")).click()
            page.keyboard.press("ArrowRight")
            expect(tabs.get_by_role("tab", name=re.compile("^Recent evidence"))).to_have_attribute("aria-selected", "true")
            expect(tabs.get_by_role("tab", name=re.compile("^Recent evidence"))).to_be_focused()
            page.keyboard.press("ArrowLeft")
            expect(tabs.get_by_role("tab", name=re.compile("^Needs review"))).to_have_attribute("aria-selected", "true")
            row("Source-linked fixture interpretation").wait_for()
            row("Fixture review desk source signal").wait_for()
            expect(page.locator(".ll-desk-item-kind").filter(has_text="Retained evidence")).to_have_count(0)
            finding_row = row("Source-linked fixture interpretation")
            finding_row.focus()
            page.keyboard.press("Enter")
            expect(finding_row).to_have_attribute("aria-pressed", "true")
            exact_preview(source)
            inspector.get_by_text("Source details and clocks", exact=True).click()
            expect(inspector.get_by_text("Provider time", exact=True)).to_be_visible()
            assert source["sourceTimestampMs"] is None
            inspector.get_by_text("Source details and clocks", exact=True).click()
            inspector.get_by_label("Source statement", exact=True).select_option(challenge["id"])
            exact_preview(challenge)

            # A real finding revision invalidates the selected source. Refresh
            # must reset to a source the current revision actually retains.
            finding = write("/v1/investigations/" + case["id"] + "/findings/" + finding["id"] + "/review", {"status": "draft", "expectedRevision": finding["revision"], "reason": "Replace this fictional counterevidence with another retained clarification.", "counterEvidenceIds": [replacement["id"]]})
            page.get_by_role("button", name="Refresh records", exact=True).click()
            expect(inspector.get_by_label("Source statement", exact=True).locator("option[value='" + replacement["id"] + "']")).to_have_count(1)
            expect(inspector.get_by_label("Source statement", exact=True).locator("option[value='" + challenge["id"] + "']")).to_have_count(0)
            expect(inspector.get_by_label("Source statement", exact=True)).to_have_value(source["id"])
            exact_preview(source)
            inspector.get_by_label("Source statement", exact=True).select_option(replacement["id"])
            exact_preview(replacement)
            finding = write("/v1/investigations/" + case["id"] + "/findings/" + finding["id"] + "/review", {"status": "draft", "expectedRevision": finding["revision"], "reason": "Remove the selected counterevidence from this fictional draft revision.", "counterEvidenceIds": []})
            page.get_by_role("button", name="Refresh records", exact=True).click()
            expect(inspector.get_by_label("Source statement", exact=True)).to_have_count(0)
            exact_preview(source)
            finding = write("/v1/investigations/" + case["id"] + "/findings/" + finding["id"] + "/review", {"status": "draft", "expectedRevision": finding["revision"], "reason": "Restore the original fictional clarification for the remaining review journey.", "counterEvidenceIds": [challenge["id"]]})
            page.get_by_role("button", name="Refresh records", exact=True).click()
            expect(inspector.get_by_label("Source statement", exact=True)).to_have_value(source["id"])
            assert finding["revision"] == 4 and finding["counterEvidenceIds"] == [challenge["id"]]
            exact_preview(source)
            inspector.get_by_label("Source statement", exact=True).select_option(challenge["id"])
            exact_preview(challenge)
            inspector.get_by_label("Source statement", exact=True).select_option(source["id"])
            exact_preview(source)
            video = inspector.locator("video")
            video.wait_for()
            page.wait_for_function('() => document.querySelector(".ll-desk-inspector video").readyState >= 1')
            page.wait_for_function('() => document.querySelector(".ll-desk-inspector video").currentTime >= .45')
            video.evaluate("async media => { media.muted = true; await media.play(); }")
            page.wait_for_function('() => document.querySelector(".ll-desk-inspector video").currentTime > .8')
            video.evaluate("media => media.pause()")
            capture("01-desktop-source-linked-finding.png")
            page.screenshot(path=str(SCREENSHOTS / "01-desktop-source-linked-finding-viewport.png"), full_page=False)
            inspector.get_by_role("button", name="Open investigation", exact=True).click()
            page.get_by_role("heading", name=case["title"], exact=True).wait_for()
            assert parse_qs(urlsplit(page.url).query).get("case") == [case["id"]]
            page.reload(wait_until="networkidle")
            page.get_by_role("heading", name=case["title"], exact=True).wait_for()
            assert parse_qs(urlsplit(page.url).query).get("case") == [case["id"]]
            page.get_by_role("button", name="All investigations", exact=True).click()
            page.get_by_role("button", name="New investigation", exact=True).wait_for()
            assert "case" not in parse_qs(urlsplit(page.url).query), "Returning to the library must clear the selected case URL"
            page.get_by_role("button", name=re.compile("^" + re.escape(other_case["title"]))).click()
            page.get_by_role("heading", name=other_case["title"], exact=True).wait_for()
            assert parse_qs(urlsplit(page.url).query).get("case") == [other_case["id"]]
            page.reload(wait_until="networkidle")
            page.get_by_role("heading", name=other_case["title"], exact=True).wait_for()
            assert parse_qs(urlsplit(page.url).query).get("case") == [other_case["id"]]
            page.get_by_role("button", name="All investigations", exact=True).click()
            assert "case" not in parse_qs(urlsplit(page.url).query)
            page.reload(wait_until="networkidle")
            page.get_by_role("button", name="New investigation", exact=True).wait_for()
            expect(page.get_by_role("heading", name=other_case["title"], exact=True)).to_have_count(0)
            assert "case" not in parse_qs(urlsplit(page.url).query)
            nav("Review desk")

            # The signal is acknowledged by the real endpoint and stays reviewable.
            signal_row = row("Fixture review desk source signal")
            signal_row.click()
            exact_preview(source)
            inspector.get_by_role("button", name="Acknowledge signal", exact=True).click()
            page.get_by_text("Signal acknowledged. A source-backed review is still required.", exact=True).wait_for()
            saved_alert = next(item for item in read("/v1/alerts")["alerts"] if item["id"] == alert["id"])
            assert saved_alert["status"] == "acknowledged"
            assert saved_alert["history"][-1]["reviewer"] == "fixture"
            assert saved_alert["history"][-1]["reason"]
            expect(signal_row.locator(".ll-desk-item-state")).to_have_text("Acknowledged")
            expect(inspector.get_by_role("button", name="Acknowledge signal", exact=True)).to_have_count(0)
            capture("02-desktop-acknowledged-signal.png")
            tabs.get_by_role("tab", name=re.compile("^Needs review")).click()
            expect(row("Fixture review desk source signal")).to_have_count(0)
            row("Source-linked fixture interpretation").wait_for()
            tabs.get_by_role("tab", name=re.compile("^All")).click()
            row("Fixture review desk source signal").click()
            exact_preview(source)
            inspector.get_by_role("button", name="Open original context", exact=True).focus()
            page.keyboard.press("Enter")
            expect(page.locator(".ll-context .ll-id")).to_have_text(source["id"])
            expect(page.locator(".ll-context blockquote")).to_have_text(statement)
            page.locator("video").wait_for()
            page.wait_for_function('() => document.querySelector("video").readyState >= 1')

            # Acknowledge a pending item while Needs review is active. Once it
            # leaves that filter, its success receipt must not describe the
            # automatically selected draft finding.
            nav("Review desk")
            transition_mission = write("/v1/missions", {"id": "review-desk-transition", "title": "Fictional selection transition mission", "protectedAccount": "fictional_target", "sessionIds": [source["sessionId"]], "rules": [{"label": "Fixture acknowledgement transition", "terms": ["desk", "@fictional_target"], "match": "all"}]})
            transition_run = write("/v1/missions/" + transition_mission["id"] + "/run", {})
            assert transition_run["created"] == 1 and transition_run["alerts"][0]["evidenceId"] == source["id"]
            page.get_by_role("button", name="Refresh records", exact=True).click()
            tabs.get_by_role("tab", name=re.compile("^Needs review")).click()
            transition_row = row("Fixture acknowledgement transition")
            transition_row.click()
            exact_preview(source)
            with page.expect_response(lambda response: response.url.endswith("/v1/alerts/" + transition_run["alerts"][0]["id"] + "/review")) as acknowledged_transition:
                inspector.get_by_role("button", name="Acknowledge signal", exact=True).click()
            assert acknowledged_transition.value.status == 201 and acknowledged_transition.value.json()["status"] == "acknowledged"
            expect(transition_row).to_have_count(0)
            selected_finding = page.locator(".ll-desk-item[aria-pressed='true'] .ll-desk-item-title").inner_text()
            assert selected_finding in {"Source-linked fixture interpretation", "Other fixture interpretation", "Context was requested"}
            expect(inspector.get_by_role("heading", name=selected_finding, exact=True)).to_be_visible()
            expect(inspector.get_by_text("Signal acknowledged. A source-backed review is still required.", exact=True)).to_have_count(0)
            expect(inspector.get_by_role("button", name="Open investigation", exact=True)).to_be_visible()
            selected_case_id = {"Source-linked fixture interpretation": case["id"], "Other fixture interpretation": other_case["id"], "Context was requested": "fixture-review"}[selected_finding]
            selected_detail = read("/v1/investigations/" + selected_case_id)
            selected_record = next(item for item in selected_detail["findings"] if item["title"] == selected_finding)
            selected_source = next(item for item in selected_detail["evidence"] if item["id"] == selected_record["supportEvidenceIds"][0])
            exact_preview(selected_source)
            capture("02a-desktop-after-acknowledgement-selection.png")

            # Explicit discovery without auto-recording cannot create hidden captures.
            nav("Review desk")
            page.get_by_role("button", name="View schedules", exact=True).click()
            page.get_by_label("Selected source", exact=True).select_option("fixture-media")
            page.get_by_label("Watch window (minutes)", exact=True).fill("1")
            page.get_by_label("Recording limit per broadcast (seconds)", exact=True).fill("8")
            page.get_by_label("Record when this source becomes available", exact=True).uncheck()
            prior_jobs = [item["id"] for item in read("/v1/jobs")["jobs"]]
            with page.expect_response(lambda response: response.url.endswith("/v1/schedules") and response.request.method == "POST") as created_schedule:
                page.get_by_role("button", name="Start bounded schedule", exact=True).click()
            assert created_schedule.value.status == 201
            schedule = created_schedule.value.json()
            assert schedule["sourceId"] == "fixture-media" and schedule["autoRecord"] is False
            assert schedule["maxDurationSeconds"] == 8 and 0 < schedule["endAtMs"] - schedule["startAtMs"] <= 61000
            page.get_by_role("button", name="Stop schedule", exact=True).click()
            page.get_by_text("Source schedule stopped.", exact=True).wait_for()
            assert next(item for item in read("/v1/schedules")["schedules"] if item["id"] == schedule["id"])["state"] == "stopped"
            assert [item["id"] for item in read("/v1/jobs")["jobs"]] == prior_jobs
            nav("Review desk")
            expect(page.get_by_role("region", name="Selected source schedules").get_by_text(re.compile("stopped · closes"))).to_be_visible()

            # Phone selection moves focus to a real detail; back restores its row.
            page.set_viewport_size({"width": 390, "height": 844})
            page.get_by_role("tab", name=re.compile("^Recent evidence")).click()
            source_row = page.locator(".ll-desk-item").filter(has_text=statement)
            source_row.focus()
            page.keyboard.press("Enter")
            exact_preview(source)
            expect(inspector).to_be_focused()
            capture("03-phone-selected-source.png")
            inspector.get_by_role("button", name="Back to inbox", exact=True).click()
            expect(source_row).to_be_focused()
            expect(inspector).not_to_be_visible()
            capture("04-phone-review-inbox.png")
            page.get_by_role("tab", name=re.compile("^Needs review")).click()
            row("Other fixture interpretation").focus()
            page.keyboard.press("Enter")
            exact_preview(challenge)
            inspector.get_by_role("button", name="View source", exact=True).click()
            expect(page.locator(".ll-context .ll-id")).to_have_text(challenge["id"])
            expect(page.locator(".ll-context blockquote")).to_have_text(counter)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")

            stop(server)
            server = launch(directory)
            page.set_viewport_size({"width": 1440, "height": 1024})
            csrf = login()
            row("Fixture review desk source signal").click()
            exact_preview(source)
            expect(row("Fixture review desk source signal").locator(".ll-desk-item-state")).to_have_text("Acknowledged")
            assert next(item for item in read("/v1/schedules")["schedules"] if item["id"] == schedule["id"])["state"] == "stopped"
            assert next(item for item in read("/v1/alerts")["alerts"] if item["id"] == alert["id"])["status"] == "acknowledged"
            capture("05-desktop-persisted-review-desk.png")
            owner_context.close()

            # Real read-only scopes suppress protection APIs and all acknowledge controls.
            stop(server)
            server = launch(directory, readonly=True)
            readonly_context = browser.new_context(viewport={"width": 1440, "height": 1024})
            page = readonly_context.new_page()
            diagnostics["page"] = page
            inspector = page.get_by_role("complementary", name="Selected source inspector")
            page.set_default_timeout(15000)
            page.on("pageerror", lambda error: errors.append(str(error)))
            ui_requests = []
            page.on("request", lambda request: ui_requests.append((request.method, urlsplit(request.url).path)))
            csrf = login("fixture-readonly", "fixture-readonly-only")
            capabilities = read("/v1/capabilities")
            assert "missions:read" not in capabilities["scopes"] and "missions:write" not in capabilities["scopes"]
            row("Source-linked fixture interpretation").click()
            exact_preview(source)
            expect(row("Fixture review desk source signal")).to_have_count(0)
            expect(page.get_by_role("button", name="Acknowledge signal", exact=True)).to_have_count(0)
            assert ("GET", "/v1/alerts") not in ui_requests, "The read-only desk must not fetch an ungranted protection resource"
            denied = page.request.post(BASE + "/v1/alerts/" + alert["id"] + "/review", data={"status": "dismissed", "reason": "This read-only fixture action must be denied."}, headers={"Origin": BASE, "x-livelens-csrf": csrf})
            assert denied.status == 403 and denied.json()["error"] == "scope_denied"
            capture("06-desktop-read-only-desk.png")
            assert not errors, errors
            receipt = {"fixture": True, "externalLiveValidated": False, "desktop1440AndPhone390": True, "sourceSelectionAndCounterevidence": True, "sourceResetAfterFindingRevisionRefresh": True, "actualPreviewPlaybackAndSeek": True, "exactOriginalContextNavigation": True, "correctInvestigationDeepLinkAndReload": True, "investigationLibrarySelectionBackAndReload": True, "signalAcknowledgementPersisted": True, "acknowledgementReceiptBoundToSelectedItem": True, "boundedScheduleWithoutHiddenCapture": True, "phoneSelectionBackAndKeyboardFocus": True, "readOnlyScopeFilteredResources": True, "actualReadOnlyWriteDenied": True, "serviceRestartReopen": True, "uncaughtPageErrors": len(errors), "screenshots": str(SCREENSHOTS)}
            (SCREENSHOTS / "receipt.json").write_text(json.dumps(receipt, indent=2))
            print(json.dumps(receipt))
            browser.close()
    except Exception as error:
        if not (SCREENSHOTS / "failure-receipt.json").exists():
            record_failure(error, page)
        raise
    finally:
        stop(server)
