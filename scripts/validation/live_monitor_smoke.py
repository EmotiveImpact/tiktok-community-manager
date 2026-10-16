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
from browser_navigation import navigate, renderer_assets

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


def recording_transport(page, csrf, first_job, second_job):
    """Operate the whole-recording controls over actual retained MP4 segments."""
    page.set_viewport_size({"width": 1440, "height": 1024})
    navigate(page, "Session library")
    page.get_by_role("region", name="Conversation and recording library", exact=True).get_by_role("button", name=re.compile("^Fictional fixture")).click()
    page.get_by_role("heading", name="Captured timeline", exact=True).wait_for()
    recording = page.get_by_label("Recording", exact=True)
    expect(recording).to_be_visible()
    assert set(recording.locator("option").evaluate_all("options => options.map(option => option.value)")) == {first_job["id"], second_job["id"]}
    recording.select_option(second_job["id"])
    video = page.locator("video")
    position = page.get_by_role("slider", name="Recording position", exact=True)
    speed = page.get_by_label("Playback speed", exact=True)
    segments = sorted(second_job["segments"], key=lambda segment: (segment["startedAtMs"], segment["id"]))
    assert len(segments) >= 2, "The actual four-second recording must contain multiple verified segments"
    total_ms = sum(segment["durationMs"] for segment in segments)
    expect(position).to_have_attribute("min", "0")
    expect(position).to_have_attribute("max", str(total_ms))
    expect(page.get_by_text("Retained time · gaps excluded", exact=True)).to_be_visible()
    segment_select = page.get_by_label("Media segment", exact=True)
    assert set(segment_select.locator("option").evaluate_all("options => options.map(option => option.value)")) == {second_job["id"] + "/" + segment["id"] for segment in segments}

    # Native range keyboard events must cross segment boundaries and seek the
    # exact retained offset, rather than reset time to the selected file.
    position.focus()
    page.keyboard.press("End")
    target_ms = float(position.input_value())
    preceding_ms = sum(segment["durationMs"] for segment in segments[:-1])
    assert preceding_ms < target_ms <= total_ms
    expected_offset = (target_ms - preceding_ms) / 1000
    last_path = "/v1/media/" + second_job["id"] + "/" + segments[-1]["id"]
    page.wait_for_function("""target => { const video = document.querySelector('video'); return video?.getAttribute('src') === target.path && video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - target.offset) < .15; }""", arg={"path": last_path, "offset": expected_offset})
    speed.select_option("1.5")
    assert video.evaluate("video => video.playbackRate") == 1.5
    page.get_by_role("button", name="Back 15 seconds", exact=True).focus()
    page.keyboard.press("Enter")
    first_path = "/v1/media/" + second_job["id"] + "/" + segments[0]["id"]
    page.wait_for_function("""path => { const video = document.querySelector('video'); return video?.getAttribute('src') === path && video.readyState >= 2 && !video.seeking && video.currentTime < .15 && video.playbackRate === 1.5; }""", arg=first_path)
    assert float(position.input_value()) < 150
    page.get_by_role("button", name="Forward 15 seconds", exact=True).click()
    page.wait_for_function("""path => { const video = document.querySelector('video'); return video?.getAttribute('src') === path && video.readyState >= 2 && !video.seeking && video.currentTime >= video.duration - .25; }""", arg=last_path)
    assert total_ms - float(position.input_value()) < 250
    assert recording.input_value() == second_job["id"]

    # Automatic continuation stays in this selected recording and preserves
    # rate. End-of-recording does not silently enter another same-session job.
    segment_select.select_option(second_job["id"] + "/" + segments[0]["id"])
    page.wait_for_function("path => document.querySelector('video')?.getAttribute('src') === path && document.querySelector('video').readyState >= 2", arg=first_path)
    video.evaluate("async video => { video.muted = true; video.currentTime = Math.max(0, video.duration - .15); await video.play(); }")
    second_path = "/v1/media/" + second_job["id"] + "/" + segments[1]["id"]
    page.wait_for_function("path => { const video = document.querySelector('video'); return video?.getAttribute('src') === path && video.readyState >= 2 && video.currentTime > .05 && !video.paused && video.playbackRate === 1.5; }", arg=second_path)
    video.evaluate("video => video.pause()")
    segment_select.select_option(second_job["id"] + "/" + segments[-1]["id"])
    page.wait_for_function("path => document.querySelector('video')?.getAttribute('src') === path && document.querySelector('video').readyState >= 2", arg=last_path)
    video.evaluate("async video => { video.currentTime = Math.max(0, video.duration - .15); await video.play(); }")
    page.wait_for_function("() => document.querySelector('video').ended")
    assert video.get_attribute("src") == last_path and recording.input_value() == second_job["id"]
    speed.select_option("1")

    # A provider timestamp inside a retained interval is not a collector/media
    # alignment. A real wall-clock gap between jobs must also stay uncovered.
    first_end = max(segment["startedAtMs"] + segment["durationMs"] for segment in first_job["segments"])
    second_start = segments[0]["startedAtMs"]
    assert second_start > first_end, "The separately requested fixture recordings must have an observed wall-clock gap"
    seeded = request(page, f"/v1/sessions/{second_job['sessionId']}/events", {"events": [
        {"source": {"adapter": "operator-transport-fixture", "eventId": "provider-only"}, "kind": "chat", "text": "Provider clock only: no collector media alignment.", "sourceTimestampMs": segments[0]["startedAtMs"] + 700, "raw": {"fixture": True}},
        {"source": {"adapter": "operator-transport-fixture", "eventId": "between-recordings"}, "kind": "gap", "text": "Observed gap between separately retained recordings.", "capturedAtMs": first_end + (second_start - first_end) // 2, "raw": {"fixture": True}},
    ]}, csrf)
    assert seeded.status == 200
    source_only, gap = [result["evidence"] for result in seeded.json()["results"]]
    assert source_only["capturedAtMs"] is None and source_only["sourceTimestampMs"] is not None
    timeline = page.get_by_role("region", name="Captured timeline", exact=True)
    query = timeline.get_by_label("Filter captured timeline", exact=True)
    position.focus()
    page.keyboard.press("Home")
    page.wait_for_function("path => document.querySelector('video')?.getAttribute('src') === path && !document.querySelector('video').seeking && document.querySelector('video').currentTime < .1", arg=first_path)
    for evidence, warning in [
        (source_only, "This evidence has no collector timestamp for media alignment."),
        (gap, "No retained segment covers this evidence's collector timestamp."),
    ]:
        query.fill(evidence["text"])
        row = timeline.locator(".ll-evidence").filter(has_text=evidence["text"])
        expect(row).to_have_count(1)
        row.focus()
        page.keyboard.press("Enter")
        expect(page.locator(".ll-context .ll-id")).to_have_text(evidence["id"])
        expect(page.get_by_text(warning, exact=True)).to_be_visible()
        assert video.get_attribute("src") == first_path and video.evaluate("video => video.currentTime") < .1
    capture(page, "09a-desktop-recording-transport.png", viewport=True)
    return {"wholeRecordingKeyboardRangeCrossesActualSegments": True,
            "recordingTransportSkipBoundsAndRatePreserved": True,
            "recordingTransportContinuesOnlyWithinSelectedJob": True,
            "providerOnlyTimestampNeverSeeksMedia": True,
            "observedBetweenRecordingGapRemainsUncovered": True}


def whole_session_search(page, csrf, segment, last_event, marker):
    """Search actual retained data beyond loaded pages, without response mocks."""
    session_id = last_event["sessionId"]
    event_path = f"/v1/sessions/{session_id}/events"
    caption_text = "Fictional fixture chat burst caption: this is labelled caption evidence."
    seeded = request(page, event_path, {"events": [{
        "source": {"adapter": "operator-search-fixture", "eventId": "caption-match"},
        "kind": "caption", "text": caption_text,
        "capturedAtMs": segment["startedAtMs"] + 250,
        "raw": {"fixture": True},
    }]}, csrf)
    assert seeded.status == 200
    caption = seeded.json()["results"][0]["evidence"]
    assert caption["sequence"] > 100 and last_event["sequence"] > 100
    off_page_bookmark = request(page, "/v1/bookmarks", {"evidenceId": last_event["id"], "label": last_event["text"][:120]}, csrf)
    assert off_page_bookmark.status == 201
    original_reads = {marker["id"]: [], last_event["id"]: []}
    def observe_original_read(http_request):
        for evidence_id, reads in original_reads.items():
            if urlsplit(http_request.url).path == "/v1/evidence/" + evidence_id and http_request.method == "GET":
                reads.append(http_request.url)
    page.on("request", observe_original_read)

    # Control real response ordering: bookmarks arrive before the event page,
    # then the page supplies a different visible bookmark while this original
    # is still in flight. No source response body is replaced or fabricated.
    held_pages = []
    held_originals = []
    hold_pages = True
    hydration_stages = []
    original_path = "/v1/evidence/" + last_event["id"]
    page_pattern = "**/v1/sessions/*/events?*"
    original_pattern = "**" + original_path

    def hold_real_page(route):
        if hold_pages and urlsplit(route.request.url).path == event_path:
            held_pages.append((route, route.fetch()))
        else:
            route.continue_()

    def hold_real_original(route):
        held_originals.append((route, route.fetch()))

    def hydration_stage(name):
        hydration_stages.append({"stage": name, "originalRequests": len(original_reads[last_event["id"]]), "otherBookmarkRequests": len(original_reads[marker["id"]])})
        (SCREENSHOTS / "hydration-request-receipt.json").write_text(json.dumps({"fixture": True, "heldActualServerResponses": True, "stages": hydration_stages}, indent=2))

    page.route(page_pattern, hold_real_page)
    page.route(original_pattern, hold_real_original)
    page.set_viewport_size({"width": 1440, "height": 1024})
    try:
        navigate(page, "Session library")
        library = page.get_by_role("region", name="Conversation and recording library", exact=True)
        library.get_by_role("button", name=re.compile("^Fictional fixture")).click()
        timeline = page.get_by_role("region", name="Captured timeline", exact=True)
        query = timeline.get_by_label("Filter captured timeline", exact=True)
        rows = timeline.locator(".ll-evidence")
        deadline = time.monotonic() + 5
        while (not held_pages or not held_originals) and time.monotonic() < deadline:
            page.wait_for_timeout(25)
        assert held_pages and held_originals, "Both delayed reads must reach the actual authenticated service"
        hydration_stage("original pending before initial event page")
        assert len(original_reads[last_event["id"]]) == 1, "Initial hydration must issue exactly one original read"
        hold_pages = False
        while held_pages:
            route, response = held_pages.pop(0)
            route.fulfill(response=response)
        expect(rows).to_have_count(100)
        page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        hydration_stage("different visible bookmark supplied by initial page")
        assert len(original_reads[last_event["id"]]) == 1, "An unrelated supplied bookmark must not restart the pending original read"
        with page.expect_response(lambda response: urlsplit(response.url).path == event_path and parse_qs(urlsplit(response.url).query).get("q") == ["Fictional fixture chat burst 0"]):
            query.fill("Fictional fixture chat burst 0")
        expect(rows).to_have_count(100)
        with page.expect_response(lambda response: urlsplit(response.url).path == event_path and parse_qs(urlsplit(response.url).query).get("q") == ["Fictional fixture chat burst 0"]):
            page.get_by_role("button", name="Refresh records", exact=True).click()
        expect(rows).to_have_count(100)
        page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        hydration_stage("unrelated filter and parent refresh while original pending")
        assert len(original_reads[last_event["id"]]) == 1, "Unrelated page and bookmark refreshes must preserve the same pending original read"
        while held_originals:
            route, response = held_originals.pop(0)
            assert response.status == 200 and response.json()["id"] == last_event["id"]
            route.fulfill(response=response)
    finally:
        for route, response in [*held_pages, *held_originals]:
            try:
                route.fulfill(response=response)
            except Exception:
                pass  # Aborted old-code requests must not mask the regression.
        page.unroute(page_pattern, hold_real_page)
        page.unroute(original_pattern, hold_real_original)
    # This new bookmark has never been in this panel's initial event page or
    # selected context. Hydration must read the real scoped original once.
    off_page_moment = page.get_by_role("region", name="Saved moments", exact=True).locator('.ll-saved-moment[data-evidence-id="' + last_event["id"] + '"]')
    expect(off_page_moment.get_by_text("Capture time", exact=True)).to_be_visible()
    expect(off_page_moment.locator("strong")).to_have_text(last_event["text"][:120])
    expect(off_page_moment.locator("time")).to_have_attribute("datetime", page.evaluate("ms => new Date(ms).toISOString()", last_event["capturedAtMs"]))
    expect(off_page_moment.locator("img")).to_have_count(1, timeout=10000)
    page.wait_for_function("""id => { const image = document.querySelector('.ll-saved-moment[data-evidence-id="' + id + '"] img'); return image?.complete && image.naturalWidth > 0; }""", arg=last_event["id"])
    hydration_stage("actual original released with decoded saved frame")
    assert len(original_reads[last_event["id"]]) == 1, "An initially off-page bookmark must hydrate its actual original once"

    def response_for(value, kind=None, after=None):
        def matches(response):
            parsed = urlsplit(response.url)
            params = parse_qs(parsed.query)
            return parsed.path == event_path and response.request.method == "GET" and params.get("q", [""]) == [value] and (kind is None or params.get("kind", ["all"]) == [kind]) and (after is None or params.get("after", ["0"]) == [str(after)])
        return matches

    # An exact match retained after sequence 100 must appear without asking the
    # operator to page through unrelated earlier evidence.
    with page.expect_response(response_for("Fictional fixture chat burst 124")) as found:
        query.fill("Fictional fixture chat burst 124")
    assert found.value.status == 200
    assert [event["id"] for event in found.value.json()["events"]] == [last_event["id"]]
    expect(rows).to_have_count(1)
    rows.first.focus()
    page.keyboard.press("Enter")
    expect(page.locator(".ll-context .ll-id")).to_have_text(last_event["id"])
    expect(page.locator(".ll-context blockquote")).to_have_text(last_event["text"])
    saved_marker = page.get_by_role("region", name="Saved moments", exact=True).locator('.ll-saved-moment[data-evidence-id="' + marker["id"] + '"]')
    expect(saved_marker.locator("strong")).to_have_text(marker["text"][:120])
    expect(saved_marker.get_by_text("Capture time", exact=True)).to_be_visible()
    expect(saved_marker.locator("time")).to_have_attribute("datetime", page.evaluate("ms => new Date(ms).toISOString()", marker["capturedAtMs"]))
    expect(saved_marker.locator("img")).to_have_count(1, timeout=10000)
    page.wait_for_function("""id => { const image = document.querySelector('.ll-saved-moment[data-evidence-id="' + id + '"] img'); return image?.complete && image.naturalWidth > 0; }""", arg=marker["id"])

    timeline.get_by_role("button", name="Chat", exact=True).click()
    with page.expect_response(response_for("Fictional fixture chat burst", "chat", 0)) as first_page:
        query.fill("Fictional fixture chat burst")
    first_events = first_page.value.json()["events"]
    assert first_page.value.status == 200 and len(first_events) == 100
    assert all(event["kind"] == "chat" for event in first_events)
    expect(rows).to_have_count(100)
    with page.expect_response(response_for("Fictional fixture chat burst", "chat", first_page.value.json()["nextAfter"])) as next_page:
        timeline.get_by_role("button", name="Next 100 events", exact=True).click()
    remaining = next_page.value.json()["events"]
    assert next_page.value.status == 200 and len(remaining) == 25
    assert remaining[-1]["id"] == last_event["id"]
    assert not ({event["id"] for event in first_events} & {event["id"] for event in remaining})
    expect(rows).to_have_count(25)
    with page.expect_response(response_for("Fictional fixture chat burst", "chat", 0)) as previous_page:
        timeline.get_by_role("button", name="Previous events", exact=True).click()
    assert previous_page.value.json()["events"] == first_events
    expect(rows).to_have_count(100)
    with page.expect_response(response_for("Fictional fixture chat burst", "caption", 0)) as captions:
        timeline.get_by_role("button", name="Captions", exact=True).click()
    assert [event["id"] for event in captions.value.json()["events"]] == [caption["id"]]
    expect(rows).to_have_count(1)
    expect(rows.first).to_contain_text(caption_text)
    expect(timeline.get_by_role("button", name="Previous events", exact=True)).to_have_count(0)
    expect(timeline.get_by_role("button", name="Next 100 events", exact=True)).to_have_count(0)

    # Exactly one full page still offers a bounded next request. An empty
    # terminal page must not erase the earlier matches or claim none exist.
    timeline.get_by_role("button", name="Chat", exact=True).click()
    with page.expect_response(response_for("Fictional fixture chat burst 0", "chat", 0)) as exact_page:
        query.fill("Fictional fixture chat burst 0")
    exact_events = exact_page.value.json()["events"]
    assert len(exact_events) == 100
    expect(rows).to_have_count(100)
    with page.expect_response(response_for("Fictional fixture chat burst 0", "chat", exact_page.value.json()["nextAfter"])) as terminal_page:
        timeline.get_by_role("button", name="Next 100 events", exact=True).click()
    assert terminal_page.value.status == 200 and terminal_page.value.json() == {"events": [], "nextAfter": None}
    expect(rows).to_have_count(0)
    expect(timeline.get_by_role("heading", name="End of these results", exact=True)).to_be_visible()
    expect(timeline.get_by_text("There are no later matching records. You can return to the previous page.", exact=True)).to_be_visible()
    expect(timeline.get_by_role("button", name="Next 100 events", exact=True)).to_be_disabled()
    with page.expect_response(response_for("Fictional fixture chat burst 0", "chat", 0)) as earlier_results:
        timeline.get_by_role("button", name="Previous events", exact=True).click()
    assert earlier_results.value.json()["events"] == exact_events
    expect(rows).to_have_count(100)
    with page.expect_response(response_for("Fictional fixture chat burst", "chat", 0)):
        query.fill("Fictional fixture chat burst")
    expect(rows).to_have_count(100)

    # Hold one real server response until a newer search has completed. The
    # late response must never replace the operator's current filtered result.
    timeline.get_by_role("button", name="Chat", exact=True).click()
    expect(rows).to_have_count(100)
    held = []
    delayed_query = "Fictional fixture chat burst 122"
    final_query = "Fictional fixture chat burst 123"

    def delay_real_response(route):
        parsed = urlsplit(route.request.url)
        if parsed.path == event_path and parse_qs(parsed.query).get("q") == [delayed_query]:
            held.append((route, route.fetch()))
        else:
            route.continue_()

    pattern = "**/v1/sessions/*/events?*"
    page.route(pattern, delay_real_response)
    try:
        query.fill(delayed_query)
        expect(rows).to_have_count(0)
        deadline = time.monotonic() + 5
        while not held and time.monotonic() < deadline:
            page.wait_for_timeout(50)
        assert held, "The delayed query must reach the actual server"
        with page.expect_response(response_for(final_query, "chat", 0)) as latest:
            query.fill(final_query)
        assert latest.value.status == 200 and len(latest.value.json()["events"]) == 1
        expect(rows).to_have_count(1)
        expect(rows.first).to_contain_text(final_query)
        with page.expect_response(response_for(delayed_query)):
            held[0][0].fulfill(response=held[0][1])
        page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        expect(query).to_have_value(final_query)
        expect(rows).to_have_count(1)
        expect(rows.first).to_contain_text(final_query)
    finally:
        for route, response in held[1:]:
            route.fulfill(response=response)
        page.unroute(pattern, delay_real_response)
    expect(saved_marker.get_by_text("Capture time", exact=True)).to_be_visible()
    expect(saved_marker.locator("img")).to_have_count(1)
    with page.expect_response(response_for(final_query, "chat", 0)):
        page.get_by_role("button", name="Refresh records", exact=True).click()
    expect(rows).to_have_count(1)
    expect(saved_marker.get_by_text("Capture time", exact=True)).to_be_visible()
    assert len(original_reads[last_event["id"]]) == 1 and len(original_reads[marker["id"]]) <= 1, "A bookmark outside the event page must not refetch its original on every query or parent refresh"
    page.remove_listener("request", observe_original_read)
    capture(page, "09-desktop-whole-session-search.png", viewport=True)

    # Create newer conversations only after the original journey's source and
    # permissions assertions. Existing reference data now falls off page one.
    newer_start = int(time.time() * 1000)
    for index in range(201):
        created = request(page, "/v1/sessions", {
            "id": f"operator-search-fixture-{index:03d}", "platform": "fixture",
            "account": "fictional_search_account", "title": f"Generated search fixture {index:03d}" if index < 200 else "One additional newer fixture conversation",
            "sourceUrl": "https://example.invalid/search-fixture", "startedAtMs": newer_start + index,
        }, csrf)
        assert created.status == 201
    initial = read(page, "/v1/sessions?limit=200&offset=0")["sessions"]
    assert len(initial) == 200 and all(item["id"] != "fixture-reference" for item in initial)
    navigate(page, "Session library")
    page.get_by_role("button", name="Refresh records", exact=True).click()
    expect(library.locator(".rl-row")).to_have_count(200)
    expect(library.locator(".rl-row").filter(has_text="Reference fixture")).to_have_count(0)
    with page.expect_response(lambda response: urlsplit(response.url).path == "/v1/sessions" and parse_qs(urlsplit(response.url).query).get("q") == ["Generated search fixture"]) as exact_library_page:
        library.get_by_label("Filter session library", exact=True).fill("Generated search fixture")
    assert len(exact_library_page.value.json()["sessions"]) == 200
    expect(library.locator(".rl-row")).to_have_count(200)
    with page.expect_response(lambda response: urlsplit(response.url).path == "/v1/sessions" and parse_qs(urlsplit(response.url).query).get("q") == ["Generated search fixture"] and parse_qs(urlsplit(response.url).query).get("offset") == ["200"]) as library_terminal:
        page.get_by_role("button", name="Next 200 sessions", exact=True).click()
    assert library_terminal.value.status == 200 and library_terminal.value.json()["sessions"] == []
    expect(library.get_by_role("heading", name="No matches on this page", exact=True)).to_be_visible()
    expect(library.get_by_text("Try another phrase, or use the page controls to return to earlier matches.", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="Previous sessions", exact=True)).to_be_enabled()
    with page.expect_response(lambda response: urlsplit(response.url).path == "/v1/sessions" and parse_qs(urlsplit(response.url).query).get("q") == ["Generated search fixture"] and parse_qs(urlsplit(response.url).query).get("offset") == ["0"]) as earlier_sessions:
        page.get_by_role("button", name="Previous sessions", exact=True).click()
    assert earlier_sessions.value.json() == exact_library_page.value.json()
    expect(library.locator(".rl-row")).to_have_count(200)
    with page.expect_response(lambda response: urlsplit(response.url).path == "/v1/sessions" and parse_qs(urlsplit(response.url).query).get("q") == ["Reference fixture"]) as across_library:
        library.get_by_label("Filter session library", exact=True).fill("Reference fixture")
    assert across_library.value.status == 200
    assert [item["id"] for item in across_library.value.json()["sessions"]] == ["fixture-reference"]
    expect(library.locator(".rl-row")).to_have_count(1)
    expect(library.locator(".rl-row strong")).to_contain_text("Reference fixture")
    library.locator(".rl-row").focus()
    page.keyboard.press("Enter")
    expect(page.get_by_role("heading", name="Captured timeline", exact=True)).to_be_visible()
    expect(timeline.locator(".ll-evidence")).to_contain_text("A different session can contain context without proving a relationship.")
    expect(page.locator("video")).to_have_count(0)
    return {"wholeSessionSearchBeyond100AndExactContext": True,
            "queryAndKindPreservedAcrossForwardBackwardPages": True,
            "kindChangeResetsCursor": True, "lateSearchResponseCannotReplaceCurrentQuery": True,
            "offPageSavedMomentKeepsOriginalClockDecodedFrameWithoutRepeatedReads": True,
            "pendingSavedOriginalSurvivesUnrelatedPageArrivalFilterAndRefresh": True,
            "exact100EventAnd200SessionTerminalPagesPreserveEarlierMatches": True,
            "wholeLibrarySearchBeyond200AndExactSession": True}


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
            expect(more_tools).to_have_attribute("aria-expanded", "false")
            page.reload(wait_until="networkidle")
            page.get_by_role("heading", name="Context graph", exact=True, level=1).wait_for()
            expect(more_tools).to_have_attribute("aria-expanded", "false")
            assert parse_qs(urlsplit(page.url).query).get("view") == ["graph"]
            more_tools.focus()
            page.keyboard.press("Enter")
            expect(more_tools).to_have_attribute("aria-expanded", "true")
            active_specialist = navigation.get_by_role("button", name="Context graph", exact=True)
            expect(active_specialist).to_have_attribute("aria-current", "page")
            active_specialist.focus()
            expect(active_specialist).to_be_focused()
            page.keyboard.press("Escape")
            expect(more_tools).to_have_attribute("aria-expanded", "false")
            expect(more_tools).to_be_focused()
            page.keyboard.press("Enter")
            expect(more_tools).to_have_attribute("aria-expanded", "true")
            page.get_by_role("heading", name="Context graph", exact=True, level=1).click()
            expect(more_tools).to_have_attribute("aria-expanded", "false")
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
                if route.request.method == "POST" and not held:
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
            held_check = held[0][1].json()
            assert [item["id"] for item in read(page, "/v1/schedules")["schedules"]] == [held_check["id"]]
            # Keep this one-shot interceptor until page close. Removing it while
            # the receipt triggers snapshot GETs races routing teardown; removing
            # it before fulfillment can forward the original POST again. Later
            # GETs and POSTs pass through unchanged above.
            with page.expect_response(lambda response: response.url.endswith("/v1/schedules") and response.request.method == "POST") as checked:
                held[0][0].fulfill(response=held[0][1])
            assert checked.value.status == 201
            check = checked.value.json()
            assert check["id"] == held_check["id"]
            assert [item["id"] for item in read(page, "/v1/schedules")["schedules"]] == [check["id"]], "Releasing the held response must not forward or create a second schedule"
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
            bookmarked_marker = request(page, "/v1/bookmarks", {"evidenceId": marker["id"], "label": marker["text"][:120]}, csrf)
            assert bookmarked_marker.status == 201 and bookmarked_marker.json()["sessionId"] == "fixture-conversation"
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
            navigate(viewer_page, "Session library", keyboard=True)
            viewer_page.get_by_role("region", name="Conversation and recording library", exact=True).get_by_role("button", name=re.compile("^Fictional fixture")).click()
            viewer_page.get_by_role("heading", name="Captured timeline", exact=True).wait_for()
            viewer_moments = viewer_page.get_by_role("region", name="Saved moments", exact=True)
            viewer_moment = viewer_moments.locator('.ll-saved-moment[data-evidence-id="' + marker["id"] + '"]')
            expect(viewer_moment).to_have_count(1)
            expect(viewer_moments.get_by_role("button", name="Add moment", exact=True)).to_have_count(0)
            expect(viewer_page.get_by_role("button", name="Bookmark moment", exact=True)).to_have_count(0)
            viewer_moment.focus()
            viewer_page.keyboard.press("Enter")
            expect(viewer_page.locator(".ll-context .ll-id")).to_have_text(marker["id"])
            expect(viewer_page.locator(".ll-context blockquote")).to_have_text(marker["text"])
            expect(viewer_page.get_by_role("button", name="Bookmark evidence", exact=True)).to_have_count(0)
            denied_bookmark = request(viewer_page, "/v1/bookmarks", {"evidenceId": marker["id"], "label": "Forbidden viewer write"}, viewer_csrf)
            assert denied_bookmark.status == 403 and denied_bookmark.json()["error"] == "scope_denied"
            assert len(read(page, "/v1/bookmarks?session=fixture-conversation")["bookmarks"]) == 1
            assert len(read(page, "/v1/jobs")["jobs"]) == 2
            schedules = read(page, "/v1/schedules")["schedules"]
            assert len(schedules) == 2 and all(item["state"] == "stopped" for item in schedules)
            assert not any(item["sourceId"] == public_source["id"] for item in schedules), "The configured public account must never be polled"
            assert len(read(page, "/v1/sources")["sources"]) == 2
            state["page"] = page
            transport_receipt = recording_transport(page, csrf, stopped_job, second_job)
            search_receipt = whole_session_search(page, csrf, segment, last_event, marker)
            assert not errors, "Live monitor must have zero uncaught page errors"
            (SCREENSHOTS / "recording-receipt.json").write_text(json.dumps(stopped_job, indent=2))
            receipt = {
                "fixture": True, "externalLiveValidated": False,
                "captureFirstDefaultHome": True, "publicTikTokConfiguredOnlyNoPolling": True,
                "primaryNavigationAndCollapsedSpecialistTools": True,
                "specialistDeepLinkAndKeyboardPopoverReopen": True,
                "specialistPopoverClosesOnSelectionEscapeAndOutsideClick": True,
                "boundedFixtureCheckWithoutRecording": True, "boundedWatchWithoutHiddenCapture": True,
                "delayedCheckReceiptDoesNotLeakToAnotherAccount": True,
                "heldCheckCreatesExactlyOneSchedule": True,
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
                "readOnlySavedMomentsOriginalReopenAndWriteDenied403": True,
                **transport_receipt,
                **search_receipt,
                "rendererAssets": renderer_assets(page),
                "uncaughtPageErrors": len(errors), "screenshots": str(SCREENSHOTS),
            }
            (SCREENSHOTS / "receipt.json").write_text(json.dumps(receipt, indent=2))
            print(json.dumps(receipt))
            browser.close()
    finally:
        stop(server)
