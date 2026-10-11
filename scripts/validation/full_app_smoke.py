"""Real operator journeys against an isolated, labelled loopback fixture.

Build the console first. This starts no external LIVE and cleans its persistent
fixture data afterward; screenshots and the validation receipt remain in /tmp.
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
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
with socket.socket() as reservation:
    reservation.bind(("127.0.0.1", 0))
    PORT = reservation.getsockname()[1]
BASE = f"http://127.0.0.1:{PORT}"
SCREENSHOTS = Path(os.environ.get("LIVELENS_SCREENSHOTS_DIR") or tempfile.mkdtemp(prefix="livelens-full-app-"))
SCREENSHOTS.mkdir(parents=True, exist_ok=True)


def launch(directory):
    env = {
        **os.environ,
        "LIVELENS_DEMO_DIR": str(directory),
        "LIVELENS_PORT": str(PORT),
        "LIVELENS_PDF_RENDERER": json.dumps({"python": sys.executable, "chromium": os.environ.get("LIVELENS_CHROMIUM", "/usr/bin/chromium")}),
    }
    log = open(SCREENSHOTS / "fixture-server.log", "ab")
    child = subprocess.Popen(["node", "services/intelligence/scripts/console-demo.mjs"], cwd=ROOT, env=env, stdout=log, stderr=log)
    log.close()
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError(f"Fixture exited: {(SCREENSHOTS / 'fixture-server.log').read_text()}")
        try:
            with urlopen(BASE + "/health", timeout=1) as response:
                if response.status == 200:
                    return child
        except OSError:
            pass
        time.sleep(.1)
    stop(child)
    raise RuntimeError("Fixture server did not become ready")


def stop(child):
    if child.poll() is not None:
        return
    child.terminate()
    try:
        child.wait(timeout=10)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=5)


with tempfile.TemporaryDirectory(prefix="livelens-full-app-data-") as directory:
    server = launch(directory)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("LIVELENS_CHROMIUM", "/usr/bin/chromium"), headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
            page.set_default_timeout(12000)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))

            def nav(label):
                navigation = page.get_by_role("navigation", name="LiveLens navigation")
                if page.viewport_size["width"] < 800:
                    page.get_by_role("button", name="Toggle navigation", exact=True).click()
                navigation.get_by_role("button", name=label, exact=True).click()

            def login():
                page.goto(BASE + "/app/", wait_until="networkidle")
                page.get_by_label("Operator name").fill("fixture")
                page.get_by_label("Password", exact=True).fill("fixture-operator-only")
                with page.expect_response(lambda response: response.url.endswith("/console/login") and response.request.method == "POST") as authenticated:
                    page.get_by_role("button", name="Open workspace", exact=True).click()
                page.get_by_role("heading", name="Overview", exact=True).wait_for()
                assert authenticated.value.status == 200, "Fixture browser login must succeed"
                return authenticated.value.json()["csrf"]

            def capture(name):
                page.evaluate("window.scrollTo(0, 0)")
                page.wait_for_timeout(150)
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Viewport overflow: {name}"
                page.screenshot(path=str(SCREENSHOTS / name), full_page=True)

            def open_investigation():
                nav("Investigations")
                page.get_by_role("button", name=re.compile("Full application fixture review")).click()
                page.get_by_role("heading", name="Full application fixture review", exact=True).wait_for()

            try:
                csrf = login()
                page.get_by_role("link", name="Skip to content").focus()
                page.keyboard.press("Enter")
                assert page.evaluate('document.activeElement.id === "ll-main"'), "Skip link did not focus the content"
                page.get_by_role("button", name="Refresh records", exact=True).click()
                capture("01-desktop-overview.png")

                # Create a real case through the new investigation workspace.
                nav("Investigations")
                page.get_by_role("button", name="New investigation", exact=True).click()
                page.get_by_label("Investigation name", exact=True).fill("Full application fixture review")
                page.get_by_label("Question", exact=True).fill("What does retained source context support, and what challenges it?")
                with page.expect_response(lambda response: response.url.endswith("/v1/cases") and response.request.method == "POST") as created:
                    page.get_by_role("button", name="Create investigation", exact=True).click()
                case = created.value.json()
                assert created.value.status == 201, case
                CASE_ID = case["id"]
                page.get_by_role("heading", name="Full application fixture review", exact=True).wait_for()

                # Actual FFmpeg recording, decoded playback and a seek from a
                # fixture collector clock remain part of the integrated journey.
                nav("Sources & captures")
                page.get_by_label("Maximum capture seconds").fill("8")
                page.get_by_role("button", name="Start bounded capture", exact=True).click()
                page.get_by_text("Capture queued.", exact=False).wait_for()
                for _ in range(50):
                    page.get_by_role("button", name="Refresh capture state", exact=True).click()
                    if page.get_by_text("recording", exact=True).count():
                        break
                    page.wait_for_timeout(200)
                assert page.get_by_text("recording", exact=True).count(), page.locator("main").inner_text()
                page.get_by_role("button", name="Stop capture", exact=True).click()
                page.get_by_role("button", name="Replay conversation", exact=True).click()
                page.locator("video").wait_for()
                page.wait_for_function('() => document.querySelector("video").readyState >= 1')
                for _ in range(20):
                    page.get_by_role("button", name="Refresh records", exact=True).click()
                    if page.get_by_role("button", name=re.compile("Synthetic fixture marker")).count():
                        break
                    page.wait_for_timeout(200)
                page.get_by_role("button", name=re.compile("Synthetic fixture marker")).first.click()
                page.wait_for_function('() => document.querySelector("video").currentTime >= .45')
                page.evaluate('async () => { const media = document.querySelector("video"); media.muted = true; await media.play(); }')
                page.wait_for_function('() => document.querySelector("video").currentTime > .8')
                page.evaluate('document.querySelector("video").pause()')
                MARKER_ID = page.locator(".ll-context .ll-id").inner_text()
                marker_text = page.locator(".ll-context blockquote").inner_text()
                page.get_by_label("Link to investigation").select_option(label="Full application fixture review")
                page.get_by_role("button", name="Link evidence", exact=True).click()
                page.get_by_text("Original evidence linked to case.", exact=True).wait_for()
                page.get_by_role("button", name="Bookmark evidence", exact=True).click()
                page.get_by_text("Evidence bookmarked.", exact=True).wait_for()
                page.get_by_role("button", name=re.compile("Keep the original conversation with the evidence")).first.click()
                page.locator(".ll-context blockquote").filter(has_text="Keep the original conversation with the evidence.").wait_for()
                COUNTER_ID = page.locator(".ll-context .ll-id").inner_text()
                counter_text = page.locator(".ll-context blockquote").inner_text()
                page.get_by_label("Link to investigation").select_option(label="Full application fixture review")
                page.get_by_role("button", name="Link evidence", exact=True).click()
                page.get_by_text("Original evidence linked to case.", exact=True).wait_for()
                capture("02-desktop-conversation.png")

                open_investigation()
                page.get_by_label(re.compile("Select evidence: Synthetic fixture marker")).first.check()
                page.get_by_label("Add a note", exact=True).fill("Read both fictional statements together. The synthetic media proves replay, not real provider access.")
                page.get_by_role("button", name="Save note", exact=True).click()
                page.get_by_text("Note saved with its evidence references.", exact=True).wait_for()
                page.get_by_role("button", name="Findings & review", exact=True).click()
                page.get_by_label("Finding title", exact=True).fill("Retained context remains essential")
                page.get_by_label("Interpretation", exact=True).fill("The fixture shows a replayable source; a nearby instruction reinforces the need to keep context. No external allegation is established.")
                page.get_by_label(re.compile("Supports finding: Synthetic fixture marker")).first.check()
                page.get_by_label(re.compile("Challenges finding: Keep the original conversation")).check()
                page.get_by_role("button", name="Save draft finding", exact=True).click()
                page.get_by_text("Draft finding saved for review.", exact=True).wait_for()
                page.get_by_text("Review or correct this finding", exact=True).click()
                page.get_by_label("Reason for this decision", exact=True).fill("Checked both linked originals and the remaining capture limitations.")
                page.get_by_role("button", name="Mark reviewed", exact=True).click()
                page.get_by_text("Finding decision saved.", exact=True).wait_for()
                page.get_by_text("2 retained revisions", exact=True).wait_for()
                capture("03-desktop-investigation.png")

                page.get_by_role("button", name="Report editor", exact=True).click()
                page.get_by_label("Report title", exact=True).fill("Reviewed and redacted fictional brief")
                page.get_by_label("Executive summary", exact=True).fill("Support and conflicting context remain linked. Selected quotation fields are redacted only in this copy.")
                page.get_by_label(re.compile("Select evidence: Synthetic fixture marker")).first.check()
                page.get_by_label("Revision reason", exact=True).fill("Prepare an explicit redacted report copy.")
                page.get_by_role("button", name="Save report revision", exact=True).click()
                page.get_by_text("Report revision saved.", exact=False).wait_for()
                assert page.get_by_label("Report title", exact=True).input_value() == "Reviewed and redacted fictional brief", "Initial editor fetch must not overwrite the operator's typed title"
                with page.expect_download() as downloaded:
                    page.get_by_role("button", name=re.compile("Evidence bundle")).click()
                report = json.loads(Path(downloaded.value.path()).read_text())
                (SCREENSHOTS / "redacted-fixture-report.json").write_text(json.dumps(report, indent=2))
                selected = next(event for event in report["evidence"] if event["id"] == MARKER_ID)
                assert selected["text"] == "[Text redacted in this report copy]"
                assert selected["attribution"]["account"] is None
                assert report["findings"][0]["status"] == "reviewed"
                assert report["findings"][0]["counterEvidenceIds"] == [COUNTER_ID]
                assert report["notes"] and report["media"][0]["segments"]
                assert marker_text not in json.dumps(report), "A redacted report must not repeat the hidden quotation elsewhere"
                assert "fictional_viewer" not in json.dumps(report), "A redacted account must not leak through report provenance"
                assert selected["sourceTimestampMs"] is None, "Fixture media must not invent a provider clock"
                with page.expect_download() as markdown:
                    page.get_by_role("button", name=re.compile("Markdown brief")).click()
                assert "Counterevidence" in Path(markdown.value.path()).read_text()
                with page.expect_download() as printable:
                    page.get_by_role("button", name=re.compile("Printable report")).click()
                assert "Redacted copy" in Path(printable.value.path()).read_text()
                with page.expect_download() as pdf:
                    page.get_by_role("button", name=re.compile("PDF report")).click()
                assert Path(pdf.value.path()).read_bytes().startswith(b"%PDF-"), "PDF must be an actual PDF, not text renamed .pdf"
                capture("04-desktop-reviewed-report.png")

                nav("Investigations")
                page.get_by_role("button", name="All investigations", exact=True).click()
                page.get_by_role("button", name="Bookmarks", exact=True).click()
                saved_marker = page.locator(".aw-bookmark").filter(has_text=marker_text).first
                saved_marker.get_by_role("button", name="Open context", exact=True).click()
                assert page.locator(".ll-context .ll-id").inner_text() == MARKER_ID
                nav("Investigations")
                page.get_by_role("button", name="Compare conversations", exact=True).click()
                page.get_by_label("Terms, separated by commas", exact=True).fill("context")
                page.get_by_role("textbox", name=re.compile("^Observed account")).fill("fictional_viewer")
                conversations = page.locator(".aw-selection-list").get_by_role("checkbox")
                for index in range(conversations.count()):
                    conversations.nth(index).check()
                page.get_by_role("button", name="Compare statements", exact=True).click()
                page.get_by_role("heading", name="Comparison evidence", exact=True).wait_for()
                page.get_by_role("button", name="Open original context", exact=True).first.wait_for()
                capture("04a-desktop-comparison.png")

                nav("Observed accounts")
                page.get_by_label("Statement or phrase", exact=True).fill("Synthetic fixture marker")
                page.get_by_label("Observed account", exact=True).fill("fictional_viewer")
                page.get_by_role("button", name="Search captures", exact=True).click()
                page.get_by_role("button", name=re.compile("Synthetic fixture marker")).first.wait_for()
                capture("04b-desktop-observed-account.png")

                # Keyboard graph activation must expose exact supporting sources.
                nav("Context graph")
                edge = page.get_by_role("button", name="captured in, observed; inspect sources").first
                edge.focus()
                page.keyboard.press("Enter")
                page.get_by_role("button", name="Open original context", exact=True).first.wait_for()
                capture("05-desktop-context-graph.png")
                page.get_by_role("button", name="Open original context", exact=True).first.click()
                page.get_by_role("heading", name="Evidence & context", exact=True).wait_for()
                assert page.locator(".ll-context .ll-id").inner_text(), "Graph source action must open a specific retained event"

                # Labelled synthetic speech metadata exercises graph identity
                # boundaries over actual retained fixture media. This does not
                # claim that a diarisation engine recognised these statements.
                recorded = next(job for job in page.request.get(BASE + "/v1/jobs").json()["jobs"] if job["segments"])
                media_segment = recorded["segments"][0]
                synthetic_statements = [
                    "Synthetic anonymous voice fixture A; the real-world speaker is unknown.",
                    "Synthetic anonymous voice fixture B; matching track labels do not identify a person.",
                ]
                inserted = page.request.post(
                    BASE + f"/v1/sessions/{recorded['sessionId']}/events",
                    headers={"Origin": BASE, "X-LiveLens-CSRF": csrf},
                    data={"events": [
                        {
                            "source": {"adapter": "fixture-graph", "eventId": f"anonymous-{index}"},
                            "kind": "transcript",
                            "text": statement,
                            "speakerId": "shared_fixture_track",
                            "sourceTimestampMs": None,
                            "capturedAtMs": media_segment["startedAtMs"] + 100,
                            "raw": {
                                "fixture": True,
                                "speechJobId": f"synthetic_graph_job_{index}",
                                "recordingJobId": recorded["id"],
                                "mediaSegmentId": media_segment["id"],
                                "mediaSha256": media_segment["sha256"],
                                "speakerTrackScope": "media-segment",
                                "speakerTrack": "anonymous-engine-track",
                                "engine": {"id": "synthetic-graph-fixture", "version": "1", "language": "en-US"},
                            },
                        }
                        for index, statement in enumerate(synthetic_statements)
                    ]},
                )
                assert inserted.status == 200, "Authenticated synthetic transcript fixture must be retained"
                graph_evidence = [result["evidence"] for result in inserted.json()["results"]]
                graph_before = page.request.get(BASE + "/v1/graph?limit=80").json()
                tracks = [node for node in graph_before["nodes"] if node["kind"] == "speaker" and set(node["evidenceIds"]) & {event["id"] for event in graph_evidence}]
                assert len(tracks) == 2 and len({node["id"] for node in tracks}) == 2, "Identical anonymous labels from different speech jobs must remain separate"
                for track in tracks:
                    assert track["identityStatus"] == "anonymous"
                    assert track["provenance"]["recordingJobId"] == recorded["id"]
                    assert track["provenance"]["mediaSegmentId"] == media_segment["id"]
                track_ids = {node["id"] for node in tracks}
                def identity_links(graph):
                    kinds = {node["id"]: node["kind"] for node in graph["nodes"]}
                    return [edge for edge in graph["edges"] if
                            (edge["from"] in track_ids and kinds[edge["to"]] in {"account", "person"}) or
                            (edge["to"] in track_ids and kinds[edge["from"]] in {"account", "person"})]

                assert not any(node["kind"] == "person" for node in graph_before["nodes"]), "Captured speech must not create a person reference"
                assert not identity_links(graph_before), "Anonymous tracks must not acquire automatic account or person links"
                source_track = next(track for track in tracks if graph_evidence[0]["id"] in track["evidenceIds"])
                nav("Overview")
                nav("Context graph")
                anonymous_nodes = page.get_by_role("button", name="Anonymous speaker track: Anonymous speaker shared_fixture_track; inspect connected evidence", exact=True)
                anonymous_nodes.first.wait_for()
                assert anonymous_nodes.count() == 2, "The interface must display both source-scoped anonymous tracks"
                anonymous_nodes.first.focus()
                page.keyboard.press("Enter")
                page.locator(".aw-detail-content .aw-notice").filter(has_text="Its account and real-world identity remain unknown").wait_for()
                page.get_by_text("One media segment", exact=True).wait_for()

                page.get_by_role("button", name="Add relationship", exact=True).click()
                page.get_by_role("combobox", name=re.compile("^From")).select_option(source_track["id"])
                page.get_by_role("combobox", name=re.compile("^To")).select_option("__person")
                page.get_by_label("New destination person reference", exact=True).fill("Fictional subject reference")
                page.get_by_label("Relationship label", exact=True).fill("Fixture reference requires human review")
                page.get_by_role("combobox", name="Interpretation", exact=True).select_option("inferred")
                page.get_by_label(synthetic_statements[0], exact=True).check()
                page.get_by_label(counter_text, exact=True).check()
                relation_reason = "Explicit fictional reference for a source-backed hypothesis; neither account nor real-world identity is established."
                page.get_by_label("Reason", exact=True).fill(relation_reason)
                with page.expect_response(lambda response: response.url.endswith("/v1/graph") and response.request.method == "POST") as saved_relation:
                    page.get_by_role("button", name="Save relationship", exact=True).click()
                assert saved_relation.value.status == 201, "A supported person-reference declaration must save"
                relation = saved_relation.value.json()
                page.get_by_text("Source-supported relationship saved.", exact=True).wait_for()
                graph_with_person = page.request.get(BASE + "/v1/graph?limit=80").json()
                person = next(node for node in graph_with_person["nodes"] if node["kind"] == "person")
                assert person["identityStatus"] == "unverified" and person["declarationStatus"] == "operator-declared"
                assert person["declaredBy"] == "fixture"
                assert relation["reason"] == relation_reason and set(relation["evidenceIds"]) == {graph_evidence[0]["id"], COUNTER_ID}
                assert [edge["id"] for edge in identity_links(graph_with_person)] == [relation["id"]], "Only the operator's explicit relation may connect a speaker and declared person"
                page.get_by_role("button", name="Connections", exact=True).click()
                page.get_by_role("button", name="Fixture reference requires human review, inferred; inspect sources", exact=True).click()
                page.get_by_text(relation_reason, exact=True).wait_for()
                page.get_by_role("button", name="Inspect speaker track", exact=True).click()
                page.locator(".aw-detail-content .aw-notice").filter(has_text="Its account and real-world identity remain unknown").wait_for()
                page.get_by_text("synthetic_graph_job_0", exact=True).wait_for()
                page.locator(".aw-related-list").get_by_role("button", name=re.compile("Fixture reference requires human review")).click()
                page.get_by_role("button", name="Inspect person reference", exact=True).click()
                page.get_by_role("heading", name="Person reference: Fictional subject reference", exact=True).wait_for()
                page.get_by_text("Unverified identity", exact=True).wait_for()
                page.locator(".aw-detail-content .aw-notice").filter(has_text="It is not a verified real-world identity").wait_for()
                page.get_by_text("Declared by fixture", exact=True).wait_for()
                capture("05a-desktop-identity-boundaries.png")
                page.locator(".aw-evidence").filter(has_text=synthetic_statements[0]).get_by_role("button", name="Open original context", exact=True).click()
                page.locator(".ll-context blockquote").filter(has_text=synthetic_statements[0]).wait_for()
                assert page.locator(".ll-context .ll-id").inner_text() == graph_evidence[0]["id"]
                assert all(page.request.get(BASE + f"/v1/evidence/{event['id']}").json()["attribution"]["account"] is None for event in graph_evidence), "Person references must not alter the retained transcript's attribution"

                nav("Missions")
                page.get_by_role("button", name="New mission", exact=True).click()
                page.get_by_label("Mission name", exact=True).fill("Fictional context protection")
                page.get_by_label(re.compile("Protected account")).fill("fictional_target")
                page.locator(".aw-selection-list label").filter(has_text="Fictional fixture").first.get_by_role("checkbox").check()
                page.get_by_label("Rule name", exact=True).fill("Context requires review")
                page.get_by_label("Terms, separated by commas", exact=True).fill("context")
                page.get_by_role("button", name="Save mission", exact=True).click()
                page.get_by_text("Mission saved.", exact=False).wait_for()
                mission = page.locator(".aw-mission").filter(has_text="Fictional context protection")
                mission.get_by_role("button", name="Run rules", exact=True).click()
                page.get_by_text("Latest run receipt", exact=True).wait_for()
                capture("06-desktop-missions.png")
                nav("Protection & alerts")
                page.get_by_role("button", name=re.compile("Context requires review")).first.click()
                page.get_by_role("button", name="Open original context", exact=True).first.wait_for()
                page.get_by_label("Review reason", exact=True).fill("Reviewed the original fictional statement and nearby explanation; no allegation is inferred.")
                page.get_by_role("button", name="Mark reviewed", exact=True).click()
                page.get_by_text("Your review has been saved with its reason.", exact=True).wait_for()
                capture("07-desktop-reviewed-alert.png")

                nav("Workspace & access")
                page.get_by_role("heading", name="Set workspace limits", exact=True).wait_for()
                page.get_by_role("button", name="Members", exact=True).click()
                page.get_by_role("heading", name="People and permissions", exact=True).wait_for()
                page.get_by_role("cell", name="fixture", exact=True).wait_for()
                page.get_by_role("button", name="Audit trail", exact=True).click()
                page.get_by_role("heading", name="Recorded actions", exact=True).wait_for()
                page.locator(".aw-table tbody tr").first.wait_for()
                capture("08-desktop-workspace-audit.png")

                # Source configuration must persist without silently creating a
                # recording or a background schedule. The URL is fictional.
                nav("Sources & captures")
                existing_jobs = page.request.get(BASE + "/v1/jobs").json()["jobs"]
                existing_schedules = page.request.get(BASE + "/v1/schedules").json()["schedules"]
                page.get_by_role("button", name="Add a source", exact=True).click()
                page.get_by_label("Source type").select_option("https")
                page.get_by_label(re.compile("Source label")).fill("Fictional additional permitted source")
                page.get_by_label("Permitted HTTPS media URL", exact=True).fill("https://example.invalid/fixture-unused.mp4")
                page.get_by_role("button", name="Save selected source", exact=True).click()
                page.get_by_text("Selected source saved.", exact=False).wait_for()
                assert [job["id"] for job in page.request.get(BASE + "/v1/jobs").json()["jobs"]] == [job["id"] for job in existing_jobs]
                assert [schedule["id"] for schedule in page.request.get(BASE + "/v1/schedules").json()["schedules"]] == [schedule["id"] for schedule in existing_schedules]

                # Reopen actual records in the phone layout, including the graph
                # scroll container and dense report forms, without document overflow.
                page.set_viewport_size({"width": 390, "height": 844})
                open_investigation()
                page.get_by_role("button", name="Findings & review", exact=True).click()
                page.get_by_text("2 retained revisions", exact=True).wait_for()
                capture("09-phone-investigation.png")
                nav("Context graph")
                page.get_by_role("button", name="Map", exact=True).click()
                page.get_by_role("button", name="Fit graph to view", exact=True).click()
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Fitted phone map overflow"
                page.get_by_role("button", name="Connections", exact=True).click()
                page.get_by_role("button", name="captured in, observed; inspect sources").first.focus()
                page.keyboard.press("Enter")
                capture("10-phone-context-graph.png")

                # Restart the actual service process and reauthenticate. Data
                # persists; session cookies do not silently survive in memory.
                stop(server)
                server = launch(directory)
                page.set_viewport_size({"width": 1440, "height": 1000})
                csrf = login()
                assert any(source["label"] == "Fictional additional permitted source" for source in page.request.get(BASE + "/v1/sources").json()["sources"])
                persisted_graph = page.request.get(BASE + "/v1/graph?limit=80").json()
                persisted_relation = next(edge for edge in persisted_graph["edges"] if edge["id"] == relation["id"])
                assert persisted_relation["reason"] == relation_reason and persisted_relation["evidenceIds"] == relation["evidenceIds"]
                assert {node["id"] for node in persisted_graph["nodes"] if node["kind"] == "speaker"} == track_ids
                persisted_person = next(node for node in persisted_graph["nodes"] if node["id"] == person["id"])
                assert persisted_person["identityStatus"] == "unverified" and persisted_person["declaredBy"] == "fixture"
                assert [edge["id"] for edge in identity_links(persisted_graph)] == [relation["id"]]
                nav("Context graph")
                page.get_by_role("button", name="Connections", exact=True).click()
                page.get_by_role("button", name="Fixture reference requires human review, inferred; inspect sources", exact=True).click()
                page.get_by_text(relation_reason, exact=True).wait_for()
                page.get_by_role("button", name="Inspect person reference", exact=True).click()
                page.get_by_role("heading", name="Person reference: Fictional subject reference", exact=True).wait_for()
                page.get_by_text("Unverified identity", exact=True).wait_for()
                page.locator(".aw-evidence").filter(has_text=synthetic_statements[0]).get_by_role("button", name="Open original context", exact=True).click()
                page.locator(".ll-context blockquote").filter(has_text=synthetic_statements[0]).wait_for()
                open_investigation()
                page.get_by_text("Read both fictional statements together.", exact=False).wait_for()
                page.get_by_role("button", name="Findings & review", exact=True).click()
                page.get_by_text("2 retained revisions", exact=True).wait_for()
                page.get_by_role("button", name="Report editor", exact=True).click()
                assert page.get_by_label("Report title", exact=True).input_value() == "Reviewed and redacted fictional brief"
                with page.expect_download() as persisted:
                    page.get_by_role("button", name=re.compile("Evidence bundle")).click()
                reopened = json.loads(Path(persisted.value.path()).read_text())
                assert reopened["editor"]["revision"] == report["editor"]["revision"]
                assert reopened["manifest"]["evidence"] == report["manifest"]["evidence"]
                nav("Session library")
                page.get_by_role("button", name=re.compile("Fictional fixture")).first.click()
                page.get_by_role("button", name=re.compile("Synthetic fixture marker")).first.click()
                page.locator("video").wait_for()
                page.wait_for_function('() => document.querySelector("video").readyState >= 1')
                assert page.locator(".ll-context blockquote").inner_text() == marker_text, "Export redaction must not change the retained original"
                assert not errors, errors
                receipt = {
                    "fixture": True,
                    "externalLiveValidated": False,
                    "desktopAndPhone": True,
                    "keyboardNavigation": True,
                    "actualMediaPlaybackAndSeek": True,
                    "sourceLinkedNoteAndReviewedFinding": True,
                    "counterevidenceRetained": True,
                    "bookmarkSaved": True,
                    "bookmarkOriginalReopened": True,
                    "crossSessionComparisonSources": True,
                    "observedAccountSearch": True,
                    "sourceConfigurationWithoutBackgroundCapture": True,
                    "graphSourcesReopened": True,
                    "syntheticGraphTranscriptFixture": True,
                    "speakerTracksRemainSourceScoped": True,
                    "operatorDeclaredUnverifiedPersonReference": True,
                    "noAutomaticIdentityLinks": True,
                    "sourceBackedRelationRestartReopen": True,
                    "phoneGraphMapAndConnections": True,
                    "missionRunAndAlertReview": True,
                    "reportRedactionAndOriginalPreserved": True,
                    "jsonMarkdownHtmlAndActualPdf": True,
                    "workspaceMembersAndAudit": True,
                    "serviceRestartReopen": True,
                    "uncaughtPageErrors": len(errors),
                    "screenshots": str(SCREENSHOTS),
                }
                (SCREENSHOTS / "receipt.json").write_text(json.dumps(receipt, indent=2))
                print(json.dumps(receipt))
            except Exception:
                page.screenshot(path=str(SCREENSHOTS / "failure.png"), full_page=True)
                (SCREENSHOTS / "failure-state.txt").write_text(page.locator("body").inner_text())
                print(f"Failure evidence: {SCREENSHOTS}", file=sys.stderr)
                raise
            finally:
                browser.close()
    finally:
        stop(server)
