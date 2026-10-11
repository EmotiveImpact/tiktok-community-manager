"""Capture-first browser acceptance using real bounded local fixture collection.

Only the generated FFmpeg source is checked or watched. A fictional public
TikTok account is configured but never polled. No external LIVE is validated.
"""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
from urllib.parse import parse_qs, urlsplit
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright
from browser_navigation import navigate

ROOT = Path(__file__).resolve().parents[2]
PORT = int(os.environ.get("LIVELENS_MONITOR_TEST_PORT", "4479"))
BASE = f"http://127.0.0.1:{PORT}"
SCREENSHOTS = Path(os.environ.get("LIVELENS_SCREENSHOTS_DIR") or tempfile.mkdtemp(prefix="livelens-live-monitor-"))
SCREENSHOTS.mkdir(parents=True, exist_ok=True)
PRIVATE_VALUES = {"fixture-operator-only", "Fictional-monitor-reader-only"}


def sanitized(value):
    text = str(value)
    for private in sorted(PRIVATE_VALUES, key=len, reverse=True):
        text = text.replace(private, "[private value removed]")
    return re.sub(r"(https?://[^\s?#]+)[?#][^\s]+", r"\1[private location removed]", text)


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
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", PORT))
    env = {**os.environ, "LIVELENS_DEMO_DIR": str(directory), "LIVELENS_PORT": str(PORT), "LIVELENS_FFMPEG_PATH": os.environ.get("LIVELENS_FFMPEG_PATH", "/usr/bin/ffmpeg"), "LIVELENS_DEMO_SPEECH": "0", "LIVELENS_DEMO_PDF": "0"}
    with open(SCREENSHOTS / "fixture-server.log", "ab") as log:
        child = subprocess.Popen(["node", "services/intelligence/scripts/console-demo.mjs"], cwd=ROOT, env=env, stdout=log, stderr=log)
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError("Monitor fixture exited; inspect its server log")
        try:
            with urlopen(BASE + "/health", timeout=1) as response:
                if response.status == 200:
                    return child
        except OSError:
            pass
        time.sleep(.1)
    stop(child)
    raise RuntimeError("Monitor fixture did not become ready")


def request(page, path, body=None, csrf=None):
    headers = {"Origin": BASE}
    if csrf:
        headers["x-livelens-csrf"] = csrf
    response = page.request.get(BASE + path, headers=headers) if body is None else page.request.post(BASE + path, data=body, headers=headers)
    return response


def read(page, path):
    response = request(page, path)
    assert response.status == 200, f"Actual fixture read failed: {path} {response.status}"
    return response.json()


def login(page, username="fixture", password="fixture-operator-only"):
    PRIVATE_VALUES.add(password)
    page.goto(BASE + "/app/", wait_until="networkidle")
    page.get_by_label("Operator name", exact=True).fill(username)
    page.get_by_label("Password", exact=True).fill(password)
    with page.expect_response(lambda response: response.url.endswith("/console/login") and response.request.method == "POST") as authenticated:
        page.get_by_role("button", name="Open workspace", exact=True).click()
    assert authenticated.value.status == 200
    identity = authenticated.value.json()
    assert identity["workspace"] == "fixture_workspace" and identity["subject"] == username
    PRIVATE_VALUES.add(identity["csrf"])
    page.get_by_role("heading", name="Live monitor", exact=True).wait_for()
    return identity["csrf"]


def eventually(probe, predicate, seconds=25):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = probe()
        if predicate(last):
            return last
        time.sleep(.15)
    raise AssertionError("Actual fixture state did not reach the required condition")


def capture(page, name, viewport=False):
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_function('() => [...document.querySelectorAll("video")].filter(media => media.getClientRects().length).every(media => media.readyState >= 2 && !media.seeking)')
    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Horizontal overflow: {name}"
    body = page.locator("body").inner_text()
    values = page.locator("input,textarea,select").evaluate_all("elements => elements.map(element => element.value)")
    assert not any(private in value for value in [body, *values] for private in PRIVATE_VALUES), "Private authentication values must not enter screenshots"
    page.screenshot(path=str(SCREENSHOTS / name), full_page=not viewport)


def playback(page):
    page.locator("video").wait_for(state="visible")
    page.wait_for_function("() => document.querySelector('video').readyState >= 2 && document.querySelector('video').duration > 0")
    page.locator("video").evaluate("video => { video.currentTime = .4; }")
    page.wait_for_function("() => document.querySelector('video').currentTime >= .39 && !document.querySelector('video').seeking")
    page.locator("video").evaluate("async video => { await video.play(); }")
    page.wait_for_function("() => document.querySelector('video').currentTime > .8")
    page.locator("video").evaluate("video => video.pause()")


@contextmanager
def diagnostics():
    state = {"page": None}
    try:
        yield state
    except Exception as error:
        page = state["page"]
        if page is not None:
            try:
                body = page.locator("body").inner_text()
                (SCREENSHOTS / "failure-state.txt").write_text(sanitized(body))
                for field in page.locator("input[type=password]").all():
                    field.fill("")
                values = page.locator("input,textarea,select").evaluate_all("elements => elements.map(element => element.value)")
                if not any(private in value for value in [body, *values] for private in PRIVATE_VALUES):
                    page.screenshot(path=str(SCREENSHOTS / "failure.png"), full_page=True)
            except Exception:
                pass
        (SCREENSHOTS / "failure-receipt.json").write_text(json.dumps({"fixture": True, "passed": False, "exception": type(error).__name__, "message": sanitized(error)}, indent=2))
        raise RuntimeError(sanitized(error)) from None


with tempfile.TemporaryDirectory(prefix="livelens-monitor-data-") as directory:
    server = None
    try:
        server = launch(directory)
        with sync_playwright() as playwright, diagnostics() as state:
            browser = playwright.chromium.launch(executable_path=os.environ.get("LIVELENS_CHROMIUM", "/usr/bin/chromium"), headless=True)
            owner_context = browser.new_context(viewport={"width": 1440, "height": 1024})
            page = owner_context.new_page()
            state["page"] = page
            page.set_default_timeout(15000)
            errors = []
            page.on("pageerror", lambda error: errors.append(sanitized(error)))
            csrf = login(page)
            watchlist = page.get_by_role("complementary", name="Selected account watchlist")
            stage = page.get_by_role("region", name="Selected source monitor")
            feed = page.get_by_role("complementary", name="Captured conversation feed")

            def source_row(label):
                return watchlist.get_by_role("button").filter(has=page.locator("strong", has_text=label))

            def schedule(schedule_id):
                return next(item for item in read(page, "/v1/schedules")["schedules"] if item["id"] == schedule_id)

            def monitor():
                navigate(page, "Live monitor")
                page.get_by_role("heading", name="Live monitor", exact=True).wait_for()
                source_row("Synthetic colour bars & tone (fixture)").wait_for()

            def replay_is_read_only(replay_id):
                # Saved media belongs to its recording source, even when an
                # unrelated configured-only account was selected beforehand.
                expect(stage.locator(".lm-stage-header p")).to_have_text(re.compile(r"^Saved recording · .+$"))
                expect(source_row(fixture["label"])).to_have_attribute("aria-pressed", "true")
                expect(source_row("@" + account)).to_have_attribute("aria-pressed", "false")
                expect(stage.get_by_role("button", name=re.compile(r"^(Check source|Check LIVE|Watch only|Record now|Record when LIVE|Stop watch|Stop recording)$"))).to_have_count(0)
                expect(stage.get_by_label("Recording limit (seconds)", exact=True)).to_have_count(0)
                expect(stage.get_by_label("Watch window (minutes)", exact=True)).to_have_count(0)
                expect(stage.get_by_role("button", name="Back to monitor", exact=True)).to_be_visible()
                page.wait_for_function("id => document.querySelector('video')?.getAttribute('src')?.startsWith('/v1/media/' + id + '/')", arg=replay_id)

            # The everyday destinations remain immediately available. Extra
            # tools are deliberately disclosed, including after a deep link.
            navigation = page.get_by_role("navigation", name="LiveLens navigation")
            more_tools = navigation.get_by_role("button", name="More tools", exact=True)
            primary = ["Live monitor", "Session library", "Review desk", "Investigations", "Cases & reports", "Agent connection"]
            specialists = ["Observed accounts", "Context graph", "Missions", "Sources & captures", "Protection & alerts", "Workspace & access", "Workspace settings"]
            for label in primary:
                expect(navigation.get_by_role("button", name=label, exact=True)).to_be_visible()
            expect(more_tools).to_have_attribute("aria-expanded", "false")
            for label in specialists:
                expect(navigation.get_by_role("button", name=label, exact=True)).not_to_be_visible()
            more_tools.focus()
            page.keyboard.press("Enter")
            expect(more_tools).to_have_attribute("aria-expanded", "true")
            for label in specialists:
                expect(navigation.get_by_role("button", name=label, exact=True)).to_be_visible()
            navigate(page, "Context graph", keyboard=True)
            page.get_by_role("heading", name="Context graph", exact=True, level=1).wait_for()
            assert parse_qs(urlsplit(page.url).query).get("view") == ["graph"]
            page.reload(wait_until="networkidle")
            page.get_by_role("heading", name="Context graph", exact=True, level=1).wait_for()
            expect(more_tools).to_have_attribute("aria-expanded", "true")
            expect(navigation.get_by_role("button", name="Context graph", exact=True)).to_have_attribute("aria-current", "page")
            navigate(page, "Live monitor", keyboard=True)
            page.reload(wait_until="networkidle")
            page.get_by_role("heading", name="Live monitor", exact=True).wait_for()
            expect(more_tools).to_have_attribute("aria-expanded", "false")

            initial_sources = read(page, "/v1/sources")["sources"]
            fixture = next(source for source in initial_sources if source["id"] == "fixture-media")
            assert fixture["fixture"] is True and fixture["providerValidated"] is False
            assert read(page, "/v1/jobs")["jobs"] == [] and read(page, "/v1/schedules")["schedules"] == []
            source_row(fixture["label"]).wait_for()
            capture(page, "01-desktop-live-monitor-ready.png", viewport=True)

            # Saving a public account is configuration, never provider discovery.
            account = "livelens_qa_saved_only"
            page.get_by_label("TikTok account to add", exact=True).fill("@" + account)
            with page.expect_response(lambda response: response.url.endswith("/v1/sources") and response.request.method == "POST") as configured:
                page.get_by_role("button", name="Add account", exact=True).click()
            assert configured.value.status == 201
            public_source = configured.value.json()
            assert public_source["kind"] == "tiktok-public" and public_source["account"] == account
            assert public_source["providerValidated"] is False and public_source["fixture"] is False
            expect(source_row("@" + account)).to_have_attribute("aria-pressed", "true")
            expect(source_row("@" + account).locator(".lm-status")).to_have_text("Unchecked")
            assert read(page, "/v1/jobs")["jobs"] == [] and read(page, "/v1/schedules")["schedules"] == []
            capture(page, "02-desktop-configured-account-unchecked.png", viewport=True)
            source_row(fixture["label"]).focus()
            page.keyboard.press("Enter")
            expect(source_row(fixture["label"])).to_have_attribute("aria-pressed", "true")
            stage.get_by_label("Recording limit (seconds)", exact=True).fill("12")
            stage.get_by_label("Watch window (minutes)", exact=True).fill("1")

            # Delay only the real server's response, then select another source.
            # The check still occurs for the fixture; its completion must not
            # claim success for the account selected afterwards.
            held = []

            def hold_check(route):
                if route.request.method == "POST":
                    held.append((route, route.fetch()))
                else:
                    route.continue_()

            page.route("**/v1/schedules", hold_check)
            stage.get_by_role("button", name="Check source", exact=True).click()
            response_deadline = time.monotonic() + 15
            while not held and time.monotonic() < response_deadline:
                page.wait_for_timeout(50)
            assert len(held) == 1, "The actual fixture check response must be held"
            source_row("@" + account).click()
            expect(source_row("@" + account)).to_have_attribute("aria-pressed", "true")
            with page.expect_response(lambda response: response.url.endswith("/v1/schedules") and response.request.method == "POST") as checked:
                held[0][0].fulfill(response=held[0][1])
            page.unroute("**/v1/schedules", hold_check)
            assert checked.value.status == 201
            check = checked.value.json()
            assert check["sourceId"] == fixture["id"] and check["autoRecord"] is False
            assert 0 < check["endAtMs"] - check["startAtMs"] <= 15000
            check = eventually(lambda: schedule(check["id"]), lambda item: item["status"] == "available" and item["pollCount"] >= 1 and item["lastCheckedAtMs"] is not None)
            assert check["sessionId"] == "fixture-conversation" and check["jobId"] is None
            assert read(page, "/v1/jobs")["jobs"] == []
            expect(stage.locator(".lm-stage-header h2")).to_have_text("@" + account)
            expect(page.get_by_text("Source check started. It ends within 15 seconds.", exact=True)).to_have_count(0)
            expect(stage.get_by_role("button", name="Check LIVE", exact=True)).to_be_enabled()
            expect(source_row("@" + account).locator(".lm-status")).to_have_text("Unchecked")
            source_row(fixture["label"]).click()
            # Backend polling finishes before the separate browser snapshot read.
            expect(source_row(fixture["label"]).locator(".lm-status")).to_have_text("Available at last check", timeout=15000)
            capture(page, "03-desktop-fixture-check-without-recording.png", viewport=True)
            with page.expect_response(lambda response: response.url.endswith(f"/v1/schedules/{check['id']}/stop")) as stop_check:
                stage.get_by_role("button", name="Stop watch", exact=True).click()
            assert stop_check.value.status == 201 and stop_check.value.json()["state"] == "stopped"
            expect(stage.get_by_role("button", name="Stop watch", exact=True)).to_have_count(0)

            with page.expect_response(lambda response: response.url.endswith("/v1/schedules") and response.request.method == "POST") as watched:
                stage.get_by_role("button", name="Watch only", exact=True).click()
            assert watched.value.status == 201
            watch = watched.value.json()
            assert watch["sourceId"] == fixture["id"] and watch["autoRecord"] is False
            assert 0 < watch["endAtMs"] - watch["startAtMs"] <= 60000
            watch = eventually(lambda: schedule(watch["id"]), lambda item: item["status"] == "available" and item["pollCount"] >= 1)
            assert watch["jobId"] is None and read(page, "/v1/jobs")["jobs"] == []

            with page.expect_response(lambda response: response.url.endswith("/v1/jobs") and response.request.method == "POST") as started:
                stage.get_by_role("button", name="Record now", exact=True).click()
            assert started.value.status == 201
            job_id = started.value.json()["id"]
            job = eventually(lambda: read(page, f"/v1/jobs/{job_id}"), lambda item: item["state"] == "recording" and bool(item["segments"]) and item["segments"][0]["durationMs"] >= 1000)
            assert job["sourceId"] == "fixture-media" and job["sessionId"] == "fixture-conversation"
            assert job["maxDurationSeconds"] == 12 and job["deadlineMs"] - job["createdAtMs"] == 12000
            segment = job["segments"][0]
            assert segment["bytes"] > 100 and segment["durationMs"] > 0
            assert re.fullmatch(r"[a-f0-9]{64}", segment["sha256"])
            assert segment["timestampBasis"] == "collector-media-offset" and segment["startedAtMs"] >= job["createdAtMs"]
            ranged = page.request.get(BASE + f"/v1/media/{job_id}/{segment['id']}", headers={"Range": "bytes=0-99"})
            assert ranged.status == 206 and len(ranged.body()) == 100
            assert ranged.headers["content-range"] == f"bytes 0-99/{segment['bytes']}"
            retained = request(page, f"/v1/media/{job_id}/{segment['id']}")
            assert retained.status == 200 and hashlib.sha256(retained.body()).hexdigest() == segment["sha256"]
            events = eventually(lambda: read(page, f"/v1/sessions/{job['sessionId']}/events?limit=200")["events"], lambda items: any(item.get("raw", {}).get("jobId") == job_id for item in items))
            marker = next(item for item in events if item.get("raw", {}).get("jobId") == job_id and item["raw"]["segmentId"] == segment["id"])
            assert marker["sourceTimestampMs"] is None and marker["receivedAtMs"] is not None
            assert segment["startedAtMs"] <= marker["capturedAtMs"] < segment["startedAtMs"] + segment["durationMs"]
            expect(feed.locator(".lm-message").filter(has_text=marker["text"]).first).to_be_visible()
            playback(page)
            capture(page, "04-desktop-actual-fixture-recording.png", viewport=True)

            # This discovery-only watch has no linked job: its stop must leave
            # the separately requested recording running until its own stop.
            with page.expect_response(lambda response: response.url.endswith(f"/v1/schedules/{watch['id']}/stop")) as stopped_watch:
                stage.get_by_role("button", name="Stop watch", exact=True).click()
            assert stopped_watch.value.status == 201 and schedule(watch["id"])["state"] == "stopped"
            assert read(page, f"/v1/jobs/{job_id}")["state"] == "recording"
            with page.expect_response(lambda response: response.url.endswith(f"/v1/jobs/{job_id}/stop")) as stopped_capture:
                stage.get_by_role("button", name="Stop recording", exact=True).click()
            assert stopped_capture.value.status == 200
            stopped_job = eventually(lambda: read(page, f"/v1/jobs/{job_id}"), lambda item: item["state"] == "stopped")
            assert stopped_job["stopRequested"] is True and stopped_job["error"] is None
            assert stopped_job["segments"] and stopped_job["segments"][0]["sha256"] == segment["sha256"]
            expect(page.get_by_role("region", name="Active recordings").locator(".lm-job")).to_have_count(0)
            recent = page.get_by_role("region", name="Recent recordings")
            replay = recent.get_by_role("button", name=f"Replay recording {job_id}", exact=True)
            expect(replay).to_contain_text("stopped")
            source_row("@" + account).click()
            expect(source_row("@" + account)).to_have_attribute("aria-pressed", "true")
            expect(stage.get_by_role("button", name="Check LIVE", exact=True)).to_be_enabled()
            replay.focus()
            page.keyboard.press("Enter")
            replay_is_read_only(job_id)
            playback(page)
            feed.locator(".lm-message").filter(has_text=marker["text"]).first.click()
            offset = (marker["capturedAtMs"] - segment["startedAtMs"]) / 1000
            page.wait_for_function("offset => Math.abs(document.querySelector('video').currentTime - offset) < .25 && !document.querySelector('video').seeking", arg=offset)
            capture(page, "05-desktop-stopped-recording-replay.png", viewport=True)
            stage.get_by_role("button", name="Back to monitor", exact=True).focus()
            page.keyboard.press("Enter")
            expect(source_row(fixture["label"])).to_have_attribute("aria-pressed", "true")
            for action in ["Check source", "Watch only", "Record now"]:
                expect(stage.get_by_role("button", name=action, exact=True)).to_be_enabled()
            expect(stage.get_by_role("button", name="Check LIVE", exact=True)).to_have_count(0)
            expect(stage.get_by_label("Recording limit (seconds)", exact=True)).to_be_visible()
            expect(stage.get_by_label("Watch window (minutes)", exact=True)).to_be_visible()
            assert len(read(page, "/v1/jobs")["jobs"]) == 1
            assert all(item["sourceId"] == fixture["id"] for item in read(page, "/v1/schedules")["schedules"])
            replay.focus()
            page.keyboard.press("Enter")
            replay_is_read_only(job_id)
            feed.locator(".lm-message").filter(has_text=marker["text"]).first.click()
            feed.get_by_role("button", name="Open original context", exact=True).click()
            expect(page.locator(".ll-context .ll-id")).to_have_text(marker["id"])
            expect(page.locator(".ll-context blockquote")).to_have_text(marker["text"])
            monitor()

            # A second actual recording shares the session. Clicking its receipt
            # must restrict playback and segment navigation to that exact job.
            stage.get_by_label("Recording limit (seconds)", exact=True).fill("4")
            with page.expect_response(lambda response: response.url.endswith("/v1/jobs") and response.request.method == "POST") as second_started:
                stage.get_by_role("button", name="Record now", exact=True).click()
            assert second_started.value.status == 201
            second_id = second_started.value.json()["id"]
            assert second_id != job_id
            second_job = eventually(lambda: read(page, f"/v1/jobs/{second_id}"), lambda item: item["state"] == "completed" and bool(item["segments"]))
            assert second_job["sessionId"] == stopped_job["sessionId"] and second_job["maxDurationSeconds"] == 4
            page.get_by_role("button", name="Refresh records", exact=True).click()
            for replay_id in [second_id, job_id]:
                source_row("@" + account).click()
                expect(source_row("@" + account)).to_have_attribute("aria-pressed", "true")
                recent.get_by_role("button", name=f"Replay recording {replay_id}", exact=True).focus()
                page.keyboard.press("Enter")
                replay_is_read_only(replay_id)
                playback(page)
                replay_job = second_job if replay_id == second_id else stopped_job
                options = [replay_id + "/" + item["id"] for item in replay_job["segments"]]
                segment_select = page.get_by_label("Media segment", exact=True)
                if len(options) > 1:
                    expect(segment_select).to_be_visible()
                    actual_options = segment_select.locator("option").evaluate_all("elements => elements.map(element => element.value)")
                    assert set(actual_options) == set(options), "Replay must offer exactly the selected job's verified segments"
                    options = actual_options
                else:
                    expect(segment_select).to_have_count(0)
                    assert page.locator("video").get_attribute("src") == "/v1/media/" + options[0]
                assert options and all(option.startswith(replay_id + "/") for option in options)
            last_segment = options[-1]
            if len(options) > 1:
                page.get_by_label("Media segment", exact=True).select_option(last_segment)
            page.wait_for_function("key => document.querySelector('video')?.getAttribute('src') === '/v1/media/' + key && document.querySelector('video').readyState >= 2", arg=last_segment)
            page.locator("video").evaluate("async video => { video.currentTime = Math.max(0, video.duration - .2); await video.play(); }")
            page.wait_for_function("() => document.querySelector('video').ended")
            assert page.locator("video").get_attribute("src") == "/v1/media/" + last_segment, "Ending the selected job must never advance into another capture"

            # Append labelled fixture chat through the actual authenticated
            # evidence transport, beyond the first 100 records of this session.
            burst = [{
                "source": {"adapter": "live-monitor-burst-fixture", "eventId": f"chat-burst-{index:03d}"},
                "kind": "chat", "account": "fictional_fixture_viewer",
                "text": f"Fictional fixture chat burst {index:03d}: generated for rolling feed acceptance.",
                "capturedAtMs": segment["startedAtMs"] + 500 + index,
                "raw": {"fixture": True, "jobId": job_id, "segmentId": segment["id"]},
            } for index in range(125)]
            appended = request(page, f"/v1/sessions/{job['sessionId']}/events", {"events": burst}, csrf)
            assert appended.status == 200 and len(appended.json()["results"]) == 125
            last_event = appended.json()["results"][-1]["evidence"]
            assert last_event["sequence"] > 100 and last_event["raw"]["fixture"] is True
            page.get_by_role("button", name="Refresh records", exact=True).click()
            expect(feed.get_by_role("button", name="Load newer events", exact=True)).to_be_visible()
            feed.get_by_role("button", name="Load newer events", exact=True).click()
            late_message = feed.locator(".lm-message").filter(has=page.get_by_text(last_event["text"], exact=True))
            expect(late_message).to_be_visible()
            assert feed.locator(".lm-message").count() <= 100
            late_message.click()
            capture(page, "06-desktop-late-chat-after-100-events.png", viewport=True)
            feed.get_by_role("button", name="Open original context", exact=True).click()
            expect(page.locator(".ll-context .ll-id")).to_have_text(last_event["id"])
            expect(page.locator(".ll-context blockquote")).to_have_text(last_event["text"])
            monitor()
            page.set_viewport_size({"width": 390, "height": 844})
            # The phone drawer is a modal keyboard surface. Background search
            # and evidence controls must never receive focus while it is open.
            toggle = page.get_by_role("button", name="Toggle navigation", exact=True)
            sidebar = page.locator(".ll-sidebar")
            toggle.focus()
            page.keyboard.press("Enter")
            expect(sidebar).to_have_attribute("role", "dialog")
            expect(sidebar).to_have_attribute("aria-modal", "true")
            expect(sidebar.get_by_role("button", name="Live monitor", exact=True)).to_be_focused()
            for _ in range(2):
                page.keyboard.press("Tab")
                assert sidebar.evaluate("element => element.contains(document.activeElement)"), "Phone navigation must keep keyboard focus inside the open drawer"
            close_navigation = sidebar.get_by_role("button", name="Close navigation", exact=True)
            sign_out = sidebar.get_by_role("button", name=re.compile(r"Sign out"))
            sign_out.focus()
            page.keyboard.press("Tab")
            expect(close_navigation).to_be_focused()
            page.keyboard.press("Shift+Tab")
            expect(sign_out).to_be_focused()
            page.keyboard.press("Escape")
            expect(sidebar).not_to_be_visible()
            expect(toggle).to_be_focused()
            page.keyboard.press("Enter")
            expect(sidebar.get_by_role("button", name="Live monitor", exact=True)).to_be_focused()
            sidebar.get_by_role("button", name="Session library", exact=True).focus()
            page.keyboard.press("Enter")
            page.get_by_role("heading", name="Session library", exact=True).wait_for()
            expect(sidebar).not_to_be_visible()
            expect(page.locator("#ll-main")).to_be_focused()
            toggle.focus()
            page.keyboard.press("Enter")
            expect(sidebar.get_by_role("button", name="Session library", exact=True)).to_be_focused()
            sidebar.get_by_role("button", name="Live monitor", exact=True).focus()
            page.keyboard.press("Enter")
            page.get_by_role("heading", name="Live monitor", exact=True).wait_for()
            expect(sidebar).not_to_be_visible()
            expect(page.locator("#ll-main")).to_be_focused()
            source_row(fixture["label"]).focus()
            page.keyboard.press("Enter")
            expect(source_row(fixture["label"])).to_have_attribute("aria-pressed", "true")
            playback(page)
            capture(page, "07-phone-live-monitor.png")

            # A real viewer credential receives recording reads, never writes.
            invited = request(page, "/v1/workspace/invitations", {"username": "monitor-viewer", "role": "viewer", "reason": "Fictional read-only monitor acceptance"}, csrf)
            assert invited.status == 201
            link = invited.json()
            PRIVATE_VALUES.update([link["token"], link["url"]])
            viewer_context = browser.new_context(viewport={"width": 1440, "height": 1024})
            viewer_page = viewer_context.new_page()
            state["page"] = viewer_page
            viewer_page.set_default_timeout(15000)
            viewer_page.on("pageerror", lambda error: errors.append(sanitized(error)))
            joined = request(viewer_page, "/console/invitations/redeem", {"token": link["token"], "password": "Fictional-monitor-reader-only"})
            assert joined.status == 200 and joined.json()["subject"] == "monitor-viewer"
            viewer_csrf = joined.json()["csrf"]
            PRIVATE_VALUES.add(viewer_csrf)
            viewer_page.goto(BASE + "/app/", wait_until="networkidle")
            viewer_page.get_by_role("heading", name="Live monitor", exact=True).wait_for()
            viewer_stage = viewer_page.get_by_role("region", name="Selected source monitor")
            expect(viewer_stage.get_by_role("button", name="Check source", exact=True)).to_be_disabled()
            expect(viewer_stage.get_by_role("button", name="Watch only", exact=True)).to_be_disabled()
            expect(viewer_stage.get_by_role("button", name="Record now", exact=True)).to_be_disabled()
            expect(viewer_page.get_by_label("TikTok account to add", exact=True)).to_have_count(0)
            assert "recordings:write" not in read(viewer_page, "/v1/capabilities")["scopes"]
            for path, body in [
                ("/v1/jobs", {"sourceId": "fixture-media", "sessionId": "fixture-conversation", "maxDurationSeconds": 12}),
                ("/v1/schedules", {"sourceId": "fixture-media", "autoRecord": False}),
                ("/v1/sources", {"kind": "tiktok-public", "account": "must_not_be_configured"}),
            ]:
                denied = request(viewer_page, path, body, viewer_csrf)
                assert denied.status == 403 and denied.json()["error"] == "scope_denied"
            playback(viewer_page)
            capture(viewer_page, "08-desktop-read-only-live-monitor.png", viewport=True)
            assert len(read(page, "/v1/jobs")["jobs"]) == 2
            schedules = read(page, "/v1/schedules")["schedules"]
            assert len(schedules) == 2 and all(item["state"] == "stopped" for item in schedules)
            assert not any(item["sourceId"] == public_source["id"] for item in schedules), "The configured public account must never be polled"
            assert len(read(page, "/v1/sources")["sources"]) == 2
            assert not errors, "Live monitor must have zero uncaught page errors"
            (SCREENSHOTS / "recording-receipt.json").write_text(json.dumps(stopped_job, indent=2))
            receipt = {
                "fixture": True, "externalLiveValidated": False,
                "captureFirstDefaultHome": True, "publicTikTokConfiguredOnlyNoPolling": True,
                "primaryNavigationAndCollapsedSpecialistTools": True,
                "specialistUrlReloadAutomaticallyExpandsNavigation": True,
                "boundedFixtureCheckWithoutRecording": True, "boundedWatchWithoutHiddenCapture": True,
                "delayedCheckReceiptDoesNotLeakToAnotherAccount": True,
                "actualFixtureCaptureAndVerifiedMediaHashRange": True,
                "actualVideoPlaybackAndSeek": True, "capturedChatAndSeparateClocks": True,
                "stopWatchKeepsIndependentCapture": True, "explicitRecordingStop": True,
                "recentRecordingKeyboardReplay": True, "originalContextReopened": True,
                "replayBindsRecordingSourceAndHidesCollectionControls": True,
                "keyboardBackToMonitorRestoresRecordingSourceControls": True,
                "twoSameSessionRecordingsReplayExactJobAndDoNotCross": True,
                "realFixtureChatBeyond100DisplayedAndOriginalContextOpened": True,
                "desktop1440AndPhone390": True, "readOnlyUiAndActualWriteDenied403": True,
                "phoneNavigationFocusTrapEscapeAndDestinationFocus": True,
                "uncaughtPageErrors": len(errors), "screenshots": str(SCREENSHOTS),
            }
            (SCREENSHOTS / "receipt.json").write_text(json.dumps(receipt, indent=2))
            print(json.dumps(receipt))
            browser.close()
    finally:
        stop(server)
