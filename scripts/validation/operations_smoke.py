"""Exercise Aperture operations with actual HTTP, persisted state and media.

Build the application first. This isolated fixture records generated local media,
uses actual filesystem permissions to fail retention cleanup, restarts the real
service and retries the same durable cleanup entry. No external provider is
contacted and no browser responses or successful operations are fabricated.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
from contextlib import contextmanager
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright
from browser_navigation import navigate, renderer_assets


ROOT = Path(__file__).resolve().parents[2]
WORKSPACE = "fictional_operations"
OTHER_WORKSPACE = "fictional_other_operations"
PASSWORD = "Fictional-operations-fixture-only"
PRIVATE_DIAGNOSTIC = "private-fixture-diagnostic-7a3fc1"
SCREENSHOTS = Path(os.environ.get("LIVELENS_SCREENSHOTS_DIR") or tempfile.mkdtemp(prefix="livelens-operations-"))
SCREENSHOTS.mkdir(parents=True, exist_ok=True)
with socket.socket() as reservation:
    reservation.bind(("127.0.0.1", 0))
    PORT = reservation.getsockname()[1]
BASE = f"http://127.0.0.1:{PORT}"
PRIVATE_VALUES = {PASSWORD, PRIVATE_DIAGNOSTIC}


def sanitized(value):
    result = str(value)
    for secret in sorted(PRIVATE_VALUES, key=len, reverse=True):
        result = result.replace(secret, "[private value removed]")
    return re.sub(r"(https?://[^\s?#]+)[?#][^\s]+", r"\1[private location removed]", result)


@contextmanager
def browser_diagnostics(current_page):
    try:
        yield
    except Exception:
        page = current_page()
        if page is not None:
            try:
                body = page.locator("body").inner_text()
                values = page.locator("input,textarea,select").evaluate_all("elements => elements.map(element => element.value)")
                (SCREENSHOTS / "failure-state.txt").write_text(sanitized(body))
                if not any(secret in value for value in [body, *values] for secret in PRIVATE_VALUES):
                    page.screenshot(path=str(SCREENSHOTS / "failure.png"), full_page=True)
            except Exception:
                pass
        raise


def stop(child):
    if child is None or child.poll() is not None:
        return
    child.terminate()
    try:
        child.wait(timeout=15)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=5)


def launch(directory, *, configured=True, corrupt_usage=False):
    directory = Path(directory)
    imports = {name: (ROOT / f"services/intelligence/src/{name}.mjs").as_uri()
               for name in ["store", "server", "governance", "recorder", "scheduler", "media-archive"]}
    imports["object_storage"] = (ROOT / "deployment/livelens/object-storage.mjs").as_uri()
    fixture = r'''import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { EvidenceStore } from __STORE__;
import { createIntelligenceServer, SCOPES } from __SERVER__;
import { Governance } from __GOVERNANCE__;
import { Recorder } from __RECORDER__;
import { Scheduler } from __SCHEDULER__;
import { MediaArchive } from __MEDIA-ARCHIVE__;
import { FilesystemObjectStorage } from __OBJECT_STORAGE__;
const dir = process.env.LIVELENS_OPERATIONS_DIR;
const workspace = __WORKSPACE__, otherWorkspace = __OTHER_WORKSPACE__;
const store = new EvidenceStore(resolve(dir, "evidence.sqlite"));
const configured = process.env.LIVELENS_OPERATIONS_CONFIGURED === "true";
const sources = [
  { id: "generated-source", workspace, sessionId: "retained-fixture", kind: "file", input: resolve(dir, "generated.mp4"), label: "Generated operations fixture" },
  { id: "invalid-source", workspace, sessionId: "failed-fixture", kind: "file", input: resolve(dir, "invalid-media"), label: "Invalid local media fixture" },
  { id: "queued-source", workspace, sessionId: "reserved-fixture", kind: "file", input: resolve(dir, "generated.mp4"), label: "Reserved operations fixture" }
];
const makeRecorder = () => new Recorder({ store, mediaRoot: resolve(dir, "media"), ffmpeg: process.env.LIVELENS_FFMPEG || "/usr/bin/ffmpeg", sources,
  maxJobBytes: 1024 * 1024, maxWorkspaceBytes: 8 * 1024 * 1024 });
let recorder;
if (configured && !existsSync(resolve(dir, "seeded.json"))) {
  for (const [id, title, age] of [
    ["retained-fixture", "Generated retired recording", 10],
    ["failed-fixture", "Invalid media failure fixture", 0],
    ["reserved-fixture", "Reserved capture fixture", 0]
  ]) store.createSession(workspace, { id, platform: "fixture", title, sourceUrl: "https://example.invalid/" + id, startedAtMs: Date.now() - age * 86400000 });
  store.createSession(otherWorkspace, { id: "private-other-session", platform: "fixture", title: "Other workspace private source", sourceUrl: "https://example.invalid/other", startedAtMs: Date.now() });
  store.append(workspace, "retained-fixture", [{ source: { adapter: "operations-fixture", eventId: "retained-original" }, kind: "chat", text: "Generated operations fixture; no external capture.", capturedAtMs: Date.now() }]);
  const seedRecorder = makeRecorder();
  seedRecorder.create(workspace, { id: "retained-job", sourceId: "generated-source", sessionId: "retained-fixture", maxDurationSeconds: 3, segmentSeconds: 2 });
  seedRecorder.create(workspace, { id: "failed-job", sourceId: "invalid-source", sessionId: "failed-fixture", maxDurationSeconds: 2, segmentSeconds: 2 });
  seedRecorder.start();
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    if (["completed", "stopped", "failed"].includes(seedRecorder.job(workspace, "retained-job").state) && seedRecorder.job(workspace, "failed-job").state === "failed") break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const retained = seedRecorder.job(workspace, "retained-job"), failed = seedRecorder.job(workspace, "failed-job");
  if (!retained.segments.length || failed.state !== "failed") throw new Error("Real local recorder fixture did not retain media and terminal failure");
  await seedRecorder.close();
  // Model a persisted raw diagnostic from an older worker. This is not a fake
  // operation result: the recording above actually failed before this marker.
  store.db.prepare("UPDATE recording_jobs SET error=? WHERE workspace=? AND id='failed-job'").run("fixture diagnostic https://example.invalid/media?token=" + __PRIVATE_DIAGNOSTIC__ + " /private/fixture/secret", workspace);
  writeFileSync(resolve(dir, "seeded.json"), JSON.stringify({ retainedBytes: retained.segments.reduce((sum, item) => sum + item.bytes, 0), retainedSeconds: retained.segments.reduce((sum, item) => sum + item.durationMs, 0) / 1000, retainedSegments: retained.segments.length, actualFailedJob: failed.state }));
}
if (configured) recorder = makeRecorder();
const scheduler = configured ? new Scheduler({ store, recorder, adapters: [] }) : undefined;
scheduler?.start(); // Empty, bounded fixture: starts no source polling or capture.
let mediaArchive;
if (process.env.LIVELENS_OPERATIONS_CORRUPT_USAGE === "true") {
  mediaArchive = new MediaArchive({ store, recorder, storage: new FilesystemObjectStorage(resolve(dir, "unused-local-archive")) });
  // Deliberate damage to persisted failure metadata, never a fabricated
  // successful archive. The actual usage verifier must reject this checksum.
  store.db.prepare(`INSERT INTO media_archives(workspace,id,recording_job_id,state,created_at,deadline,max_seconds,max_attempts,error,manifest,manifest_sha256,object_key)
    VALUES(?,?,?,'failed',?,?,30,3,'archive_manifest_integrity_failed',?,?,?)`).run(workspace, "damaged-archive", "failed-job", Date.now(), Date.now() + 30000,
      JSON.stringify({ workspace, archiveId: "damaged-archive", segments: [] }), "deliberately-damaged-checksum", "fictional-unused-object");
}
const users = [
  { username: "fixture-owner", workspace, scopes: SCOPES },
  { username: "fixture-reader", workspace, scopes: ["workspace:read", "sessions:read", "evidence:read", "cases:read"] },
  { username: "fixture-no-scope", workspace, scopes: ["sessions:read", "evidence:read", "cases:read"] },
  { username: "fixture-other-owner", workspace: otherWorkspace, scopes: SCOPES }
].map(user => ({ ...user, password: process.env.LIVELENS_OPERATIONS_PASSWORD }));
const governance = new Governance({ store, recorder, members: users.map(user => ({ workspace: user.workspace, subject: user.username, role: user.username.includes("owner") ? "owner" : "viewer" })) });
const server = createIntelligenceServer({ store, recorder, scheduler, governance, mediaArchive,
  keys: [{ token: randomBytes(32).toString("base64url"), workspace, subject: "fixture-owner", scopes: SCOPES }],
  browser: { origin: "http://127.0.0.1:" + process.env.LIVELENS_PORT, bundleDir: __BUNDLE__, users }
});
server.listen(Number(process.env.LIVELENS_PORT), "127.0.0.1");
const close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await mediaArchive?.close(); await scheduler?.close(); await recorder?.close(); store.close(); process.exit(0); };
process.once("SIGTERM", close); process.once("SIGINT", close);
'''
    replacements = {**{name.upper(): value for name, value in imports.items()}, "WORKSPACE": WORKSPACE,
                    "OTHER_WORKSPACE": OTHER_WORKSPACE, "PRIVATE_DIAGNOSTIC": PRIVATE_DIAGNOSTIC,
                    "BUNDLE": str(ROOT / "dist")}
    for key, value in replacements.items():
        fixture = fixture.replace("__" + key + "__", json.dumps(value))
    entry = directory / "operations-fixture.mjs"
    entry.write_text(fixture)
    env = {**os.environ, "LIVELENS_OPERATIONS_DIR": str(directory), "LIVELENS_PORT": str(PORT),
           "LIVELENS_OPERATIONS_PASSWORD": PASSWORD, "LIVELENS_OPERATIONS_CONFIGURED": str(configured).lower(),
           "LIVELENS_OPERATIONS_CORRUPT_USAGE": str(corrupt_usage).lower()}
    with (directory / "server.log").open("ab") as log:
        child = subprocess.Popen(["node", str(entry)], cwd=ROOT, env=env, stdout=log, stderr=log)
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError("Operations fixture exited: " + sanitized((directory / "server.log").read_text()[-4000:]))
        try:
            with urlopen(BASE + "/health", timeout=1) as response:
                if response.status == 200:
                    return child
        except OSError:
            pass
        time.sleep(.1)
    stop(child)
    raise RuntimeError("Operations fixture did not become ready")


def login(page, user="fixture-owner"):
    page.goto(BASE + "/app/", wait_until="networkidle")
    page.get_by_label("Operator name", exact=True).fill(user)
    page.get_by_label("Password", exact=True).fill(PASSWORD)
    with page.expect_response(lambda response: response.url.endswith("/console/login") and response.request.method == "POST") as completed:
        page.get_by_role("button", name="Open workspace", exact=True).click()
    assert completed.value.status == 200
    identity = completed.value.json()
    PRIVATE_VALUES.add(identity["csrf"])
    page.get_by_role("heading", name="Live monitor", exact=True).wait_for()
    return identity["csrf"]


def request(page, path, body=None, *, csrf=None, expected=200):
    headers = {"Origin": BASE}
    if csrf:
        headers["x-livelens-csrf"] = csrf
    response = page.request.get(BASE + path, headers=headers) if body is None else page.request.post(BASE + path, data=body, headers=headers)
    assert response.status == expected, f"{path}: expected {expected}, received {response.status}: {sanitized(response.text())}"
    return response.json()


def capture(page, name, layouts, *, full_page=True):
    body = page.locator("body").inner_text()
    values = page.locator("input,textarea,select").evaluate_all("elements => elements.map(element => element.value)")
    assert not any(secret in value for value in [body, *values] for secret in PRIVATE_VALUES), "Private fixture diagnostics or credentials must not appear"
    # Keyboard navigation leaves the pointer over the rail disclosure. Move it
    # into neutral header space so its hover tooltip cannot obscure the capture.
    page.mouse.move(page.viewport_size["width"] - 2, 2)
    page.evaluate("window.scrollTo(0, 0)")
    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    geometry = page.evaluate("""() => ({width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        footerBottom: Math.ceil(document.querySelector('.ll-footer')?.getBoundingClientRect().bottom + scrollY),
        appBottom: Math.ceil(document.querySelector('.ll-app')?.getBoundingClientRect().bottom + scrollY)})""")
    assert geometry["scrollWidth"] <= geometry["width"], f"Horizontal overflow: {name}: {geometry}"
    assert geometry["scrollHeight"] <= max(geometry["height"], geometry["footerBottom"], geometry["appBottom"]) + 4, f"Blank scroll tail: {name}: {geometry}"
    page.screenshot(path=str(SCREENSHOTS / name), full_page=full_page)
    layouts[name] = geometry
    (SCREENSHOTS / "layout-receipt.json").write_text(json.dumps(layouts, indent=2))


def open_operations(page, *, keyboard=False):
    navigate(page, "Workspace & access", keyboard=keyboard)
    control = page.get_by_role("button", name="Operations", exact=True)
    if keyboard:
        control.focus()
        page.keyboard.press("Enter")
    else:
        control.click()
    expect(page.get_by_role("heading", name="Keep the work moving.", exact=True)).to_be_visible()
    expect(page.get_by_role("heading", name="Work in progress", exact=True)).to_be_visible()


def main():
    server = None
    page = None
    layouts = {}
    page_errors = []
    console_warnings = []
    checks = []
    with tempfile.TemporaryDirectory(prefix="livelens-operations-data-") as temporary:
        directory = Path(temporary)
        media_directory = directory / "media" / WORKSPACE / "retained-job"
        try:
            if hasattr(os, "geteuid") and os.geteuid() == 0:
                raise RuntimeError("Run this acceptance as a non-root user: cleanup failure must be a real filesystem permission refusal")
            (directory / "invalid-media").write_text("Labelled local fixture: these bytes are not a media container.\n")
            generated = directory / "generated.mp4"
            subprocess.run([os.environ.get("LIVELENS_FFMPEG", "/usr/bin/ffmpeg"), "-hide_banner", "-loglevel", "error",
                            "-f", "lavfi", "-i", "testsrc=size=320x180:rate=10", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
                            "-t", "3", "-c:v", "mpeg4", "-q:v", "4", "-c:a", "aac", str(generated)], check=True, timeout=30)
            server = launch(directory)
            media_receipt = json.loads((directory / "seeded.json").read_text())
            assert media_receipt["retainedBytes"] > 0 and media_receipt["retainedSegments"] > 0
            assert media_receipt["actualFailedJob"] == "failed"
            with sync_playwright() as playwright, browser_diagnostics(lambda: page):
                browser = playwright.chromium.launch(executable_path=os.environ.get("LIVELENS_CHROMIUM", "/usr/bin/chromium"), headless=True, args=["--no-sandbox"])
                context = browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
                page = context.new_page()
                page.on("pageerror", lambda error: page_errors.append(sanitized(error)))
                page.on("console", lambda message: console_warnings.append(sanitized(message.text)) if message.type == "warning" else None)
                csrf = login(page)
                assets = renderer_assets(page)
                queued = request(page, "/v1/jobs", {"id": "reserved-job", "sourceId": "queued-source", "sessionId": "reserved-fixture", "maxDurationSeconds": 30, "segmentSeconds": 2}, csrf=csrf, expected=201)
                assert queued["state"] == "queued"
                operations = request(page, "/v1/workspace/operations")
                assert operations["workspace"] == WORKSPACE and operations["capacity"]["available"]
                workers = {worker["id"]: worker for worker in operations["workers"]}
                assert workers["recording"]["configured"] and workers["recording"]["state"] == "stopped"
                assert workers["recording"]["counts"]["pending"] == 1 and workers["recording"]["counts"]["failed"] == 1
                budget = workers["recording"]["recordingBudget"]
                assert budget["retainedBytes"] == media_receipt["retainedBytes"] and budget["reservedBytes"] == 1024 * 1024
                assert budget["availableBytes"] == budget["limitBytes"] - budget["retainedBytes"] - budget["reservedBytes"]
                assert budget["requiredForNextRecordingBytes"] == 1024 * 1024
                assert workers["scheduling"]["state"] == "idle"
                assert workers["speech"]["state"] == "not-configured" and workers["archive"]["state"] == "not-configured"
                meters = {meter["id"]: meter for meter in operations["capacity"]["meters"]}
                assert meters["recordingSeconds"]["used"] == media_receipt["retainedSeconds"]
                assert meters["recordingSeconds"]["reserved"] == 30
                assert meters["recordingSeconds"]["remaining"] == meters["recordingSeconds"]["limit"] - media_receipt["retainedSeconds"] - 30
                assert meters["storageBytes"]["used"] == media_receipt["retainedBytes"]
                failed = next(item for item in operations["attention"] if item["jobId"] == "failed-job")
                assert failed["error"] == "job_failed"
                assert PRIVATE_DIAGNOSTIC not in json.dumps(operations) and "/private/fixture" not in json.dumps(operations)
                checks.append("Actual generated media, actual failed capture, queued reservation and redacted persisted diagnostic")

                navigate(page, "Workspace & access", keyboard=True)
                expect(page.get_by_role("heading", name="Set workspace limits", exact=True)).to_be_visible()
                expect(page.get_by_role("heading", name="Keep the work moving.", exact=True)).to_have_count(0)
                open_operations(page, keyboard=True)
                work = page.get_by_role("region", name="Work in progress")
                expect(work.get_by_role("article").filter(has=page.get_by_role("heading", name="Recording", exact=True))).to_contain_text("Stopped")
                expect(work.get_by_role("article").filter(has=page.get_by_role("heading", name="Source checks", exact=True))).to_contain_text("Idle")
                expect(work.get_by_role("article").filter(has=page.get_by_role("heading", name="Transcription", exact=True))).to_contain_text("Not configured")
                expect(page.get_by_role("meter", name="Recorded media committed capacity", exact=True)).to_have_attribute("value", str(meters["recordingSeconds"]["committed"]))
                expect(page.get_by_role("heading", name="job failed", exact=True)).to_be_visible()
                refresh = page.get_by_role("button", name="Refresh operations", exact=True)
                refresh.focus()
                with page.expect_response(lambda response: response.url.endswith("/v1/workspace/operations")) as refreshed:
                    page.keyboard.press("Enter")
                assert refreshed.value.status == 200
                capture(page, "01-desktop-operations.png", layouts)
                capture(page, "01a-desktop-operations-viewport.png", layouts, full_page=False)
                page.get_by_role("button", name="Open conversation", exact=True).click()
                expect(page).to_have_url(re.compile(r"view=sessions&session=failed-fixture$"))
                expect(page.get_by_role("heading", name="Invalid media failure fixture", exact=True)).to_be_visible()
                open_operations(page)
                checks.append("Workspace retains Usage default; keyboard Operations and refresh report actual stopped, idle and unconfigured workers")

                # New contexts exercise independent authenticated principals, not
                # mocked browser responses or a user-selected workspace field.
                reader_context = browser.new_context(viewport={"width": 1440, "height": 1000})
                reader = reader_context.new_page()
                reader.on("pageerror", lambda error: page_errors.append(sanitized(error)))
                reader_csrf = login(reader, "fixture-reader")
                restricted = request(reader, "/v1/workspace/operations")
                assert all(worker == {"id": worker["id"], "access": "restricted"} for worker in restricted["workers"])
                assert restricted["attention"] == [] and restricted["cleanup"] == {"canManage": False}
                request(reader, "/v1/workspace/retention/cleanup", expected=403)
                open_operations(reader)
                expect(reader.get_by_text("Restricted", exact=True)).to_have_count(4)
                expect(reader.get_by_role("button", name="Review retention and cleanup history", exact=False)).to_have_count(0)
                capture(reader, "02-desktop-restricted-workers.png", layouts)

                denied_context = browser.new_context()
                denied = denied_context.new_page()
                denied.on("pageerror", lambda error: page_errors.append(sanitized(error)))
                login(denied, "fixture-no-scope")
                assert request(denied, "/v1/workspace/operations", expected=403)["error"] == "scope_denied"
                denied_context.close()

                other_context = browser.new_context()
                other = other_context.new_page()
                other.on("pageerror", lambda error: page_errors.append(sanitized(error)))
                other_csrf = login(other, "fixture-other-owner")
                other_operations = request(other, "/v1/workspace/operations?workspace=" + WORKSPACE)
                assert other_operations["workspace"] == OTHER_WORKSPACE and not other_operations["attention"]
                assert all(meter["used"] == 0 and meter["reserved"] == 0 for meter in other_operations["capacity"]["meters"])
                checks.append("Independent scope and workspace boundaries; restricted worker details omitted from API and interface")

                # Retention removes eligible records only after an explicit
                # preview/selection. Directory write denial is an actual OS
                # failure; the original directory inode stays intact for retry.
                page.get_by_role("button", name="Retention", exact=True).click()
                page.get_by_label("Retain for days", exact=False).fill("2")
                page.get_by_label("Change or deletion reason", exact=True).fill("Fictional retention acceptance policy.")
                with page.expect_response(lambda response: response.url.endswith("/v1/workspace/retention") and response.request.method == "POST") as configured:
                    page.get_by_role("button", name="Save preference", exact=True).click()
                assert configured.value.status == 201
                page.get_by_role("button", name="Preview eligible records", exact=True).click()
                page.get_by_role("checkbox", name=re.compile("Generated retired recording")).check()
                page.get_by_role("checkbox", name=re.compile("I intend to delete these 1 selected sessions")).check()
                page.get_by_label("Change or deletion reason", exact=True).fill("Explicitly remove only the generated retired fixture.")
                identity_before = media_directory.stat().st_ino
                media_directory.chmod(0o500)
                with page.expect_response(lambda response: response.url.endswith("/v1/workspace/retention/apply") and response.request.method == "POST") as applied:
                    page.get_by_role("button", name="Delete selected eligible records", exact=True).click()
                assert applied.value.status == 201
                result = applied.value.json()
                assert result["deletedSessions"] == 1 and result["cleanupFailures"] == ["retained-job"]
                assert len(result["cleanupTasks"]) == 1
                cleanup = result["cleanupTasks"][0]
                assert cleanup["state"] == "failed" and cleanup["error"] == "cleanup_filesystem_failed" and cleanup["attempts"] == 1
                assert cleanup["bytes"] == media_receipt["retainedBytes"]
                assert media_directory.exists() and media_directory.stat().st_ino == identity_before
                assert request(page, "/v1/sessions/retained-fixture", expected=404)["error"] == "session_not_found"
                expect(page.get_by_role("heading", name="Media cleanup", exact=True)).to_be_visible()
                expect(page.get_by_role("alert")).to_contain_text("1 media cleanup task remains unfinished. Storage stays reserved until removal completes.")
                expect(page.get_by_text("cleanup filesystem failed", exact=True)).to_be_visible()
                expect(page.get_by_text("Media cleanup completed. Its storage reservation has been released.", exact=True)).to_have_count(0)
                capture(page, "03-desktop-retention-cleanup-failed.png", layouts)
                retained_failure_text = page.locator("body").inner_text()
                assert "Storage" in retained_failure_text or "storage" in retained_failure_text

                cleanup_id = cleanup["id"]
                request(reader, f"/v1/workspace/retention/cleanup/{cleanup_id}/retry", {"reason": "Viewer cannot retry"}, csrf=reader_csrf, expected=403)
                assert request(other, "/v1/workspace/retention/cleanup")["tasks"] == []
                request(other, f"/v1/workspace/retention/cleanup/{cleanup_id}/retry", {"reason": "Other workspace cannot retry"}, csrf=other_csrf, expected=404)
                reader_context.close()
                other_context.close()
                open_operations(page)
                pending = request(page, "/v1/workspace/operations")
                assert pending["capacity"]["storage"]["pendingCleanupBytes"] == media_receipt["retainedBytes"]
                assert pending["capacity"]["storage"]["localBytes"] == 0
                storage = next(meter for meter in pending["capacity"]["meters"] if meter["id"] == "storageBytes")
                assert storage["used"] == 0 and storage["reserved"] == media_receipt["retainedBytes"]
                assert pending["cleanup"]["failedCount"] == 1
                expect(page.get_by_text("1 cleanup task remains. Storage stays reserved until removal completes.", exact=True)).to_be_visible()
                capture(page, "04-desktop-pending-cleanup.png", layouts)
                checks.append("Real filesystem cleanup refusal remains failed, visible and quota-reserved after database deletion")

                page.set_viewport_size({"width": 390, "height": 844})
                capture(page, "05-phone-pending-cleanup.png", layouts)
                page.get_by_text("How storage is counted", exact=True).click()
                expect(page.get_by_text("Awaiting cleanup", exact=True)).to_be_visible()
                capture(page, "05a-phone-storage-breakdown.png", layouts)

                stop(server)
                server = launch(directory)
                csrf = login(page)
                durable = request(page, "/v1/workspace/retention/cleanup")["tasks"]
                assert durable == [cleanup], "The same failed task and exact attempts must survive restart"
                assert media_directory.stat().st_ino == identity_before
                open_operations(page, keyboard=True)
                page.get_by_role("button", name="Review cleanup", exact=True).click()
                page.get_by_role("button", name="Review cleanup for retained-job", exact=True).click()
                retry = page.get_by_role("button", name="Retry selected cleanup", exact=True)
                expect(retry).to_be_disabled()
                page.get_by_label("Cleanup retry reason", exact=True).fill("Verify the same unresolved permission failure after restart.")
                retry.focus()
                with page.expect_response(lambda response: response.url.endswith(f"/v1/workspace/retention/cleanup/{cleanup_id}/retry") and response.request.method == "POST") as still_failed:
                    page.keyboard.press("Enter")
                assert still_failed.value.status == 201
                retry_failure = still_failed.value.json()
                assert retry_failure["id"] == cleanup_id and retry_failure["state"] == "failed" and retry_failure["attempts"] == 2
                expect(page.get_by_role("alert")).to_contain_text("Storage remains reserved.")
                expect(page.get_by_label("Cleanup retry reason", exact=True)).to_have_value("Verify the same unresolved permission failure after restart.")
                assert request(page, "/v1/workspace/usage")["pendingCleanupBytes"] == media_receipt["retainedBytes"]
                capture(page, "06-phone-durable-retry-failed.png", layouts)

                media_directory.chmod(0o700)
                page.get_by_label("Cleanup retry reason", exact=True).fill("Restored write permission on the original generated-media directory.")
                with page.expect_response(lambda response: response.url.endswith(f"/v1/workspace/retention/cleanup/{cleanup_id}/retry") and response.request.method == "POST") as retried:
                    page.get_by_role("button", name="Retry selected cleanup", exact=True).click()
                assert retried.value.status == 201
                completed = retried.value.json()
                assert completed["id"] == cleanup_id and completed["state"] == "completed" and completed["attempts"] == 3
                assert completed["error"] is None and not media_directory.exists()
                expect(page.get_by_text("Media cleanup completed. Its storage reservation has been released.", exact=True)).to_be_visible()
                expect(page.get_by_text("1 session removed from the workspace.", exact=True)).to_have_count(0)
                assert request(page, "/v1/workspace/usage")["pendingCleanupBytes"] == 0
                expect(page.get_by_role("button", name="Review cleanup for retained-job", exact=True)).to_have_count(0)
                capture(page, "07-phone-cleanup-complete.png", layouts)
                checks.append("Failed cleanup survives restart; another actual failure preserves reason/reservation; corrected original path completes same task and releases bytes")

                audit = request(page, "/v1/workspace/audit?limit=100")["entries"]
                assert any(entry["action"] == "retention.session.deleted" for entry in audit)
                assert any(entry["action"] == "retention.cleanup.failed" for entry in audit)
                assert any(entry["action"] == "retention.cleanup.completed" for entry in audit)
                stopped = request(page, "/v1/jobs/reserved-job/stop", {}, csrf=csrf)
                assert stopped["state"] in ["stopping", "stopped"]
                stop(server)
                server = launch(directory, configured=False)
                page.set_viewport_size({"width": 1440, "height": 1000})
                login(page)
                unconfigured = request(page, "/v1/workspace/operations")
                assert all(worker["configured"] is False and worker["state"] == "not-configured" for worker in unconfigured["workers"])
                assert request(page, "/v1/workspace/retention/cleanup")["tasks"][0] == completed
                open_operations(page)
                expect(page.get_by_role("region", name="Work in progress").get_by_text("Not configured", exact=True)).to_have_count(8)
                capture(page, "08-desktop-workers-unconfigured.png", layouts)
                checks.append("Removed runtime configuration is explicitly unconfigured; successful durable cleanup receipt persists on later restart")

                stop(server)
                server = launch(directory, corrupt_usage=True)
                damaged_context = browser.new_context(viewport={"width": 1440, "height": 1000})
                damaged = damaged_context.new_page()
                damaged.on("pageerror", lambda error: page_errors.append(sanitized(error)))
                page = damaged  # Failure diagnostics follow the fresh context.
                login(damaged)
                workspace_failure = request(damaged, "/v1/workspace", expected=409)
                assert workspace_failure["error"] == "archive_manifest_integrity_failed"
                damaged_operations = request(damaged, "/v1/workspace/operations")
                assert damaged_operations["capacity"] == {"available": False, "error": "usage_unavailable"}
                assert any(item["jobId"] == "damaged-archive" for item in damaged_operations["attention"])
                navigate(damaged, "Workspace & access", keyboard=True)
                expect(damaged.get_by_role("button", name="Operations", exact=True)).to_be_visible()
                expect(damaged.get_by_text("Workspace details unavailable", exact=True)).to_be_visible()
                expect(damaged.get_by_role("heading", name="Set workspace limits", exact=True)).to_have_count(0)
                fallback = damaged.get_by_role("button", name="Open Operations", exact=True)
                fallback.focus()
                damaged.keyboard.press("Enter")
                expect(damaged.get_by_role("heading", name="Work in progress", exact=True)).to_be_visible()
                expect(damaged.get_by_text("Capacity unavailable", exact=True)).to_be_visible()
                expect(damaged.get_by_role("meter", name="Storage committed capacity", exact=True)).to_have_count(0)
                expect(damaged.get_by_role("heading", name="archive manifest integrity failed", exact=True)).to_be_visible()
                expect(damaged.get_by_role("region", name="Work in progress").get_by_role("article").filter(has=damaged.get_by_role("heading", name="Recording", exact=True))).to_contain_text("Stopped")
                capture(damaged, "09-desktop-capacity-unavailable.png", layouts)
                damaged.set_viewport_size({"width": 390, "height": 844})
                capture(damaged, "10-phone-capacity-unavailable.png", layouts)
                checks.append("Fresh workspace entry survives actual corrupt archive usage: workspace metadata refuses409 while Operations shows failures and unavailable capacity, never zero")
                final_assets = renderer_assets(page)
                assert assets == final_assets, "All browser stages must use identical actual built assets"
                assert page_errors == [], page_errors
                assert not any("same key" in item or "unique" in item.lower() for item in console_warnings), console_warnings
                receipt = {"fixture": True, "passed": True, "externalProvidersContacted": False, "screenshots": list(layouts),
                           "rendererAssets": final_assets, "checks": checks, "media": media_receipt,
                           "cleanup": {"initial": cleanup, "afterRestartFailure": retry_failure, "completed": completed},
                           "pageErrors": page_errors, "consoleWarnings": console_warnings,
                           "filesystemFailure": "Actual non-root directory permission denial; original directory inode preserved across restart",
                           "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
                (SCREENSHOTS / "browser-receipt.json").write_text(json.dumps(receipt, indent=2))
                print(json.dumps({"passed": True, "checks": len(checks), "screenshots": len(layouts), "artifacts": str(SCREENSHOTS)}))
                context.close()
                damaged_context.close()
                browser.close()
        except Exception as error:
            if page is not None:
                try:
                    body = page.locator("body").inner_text()
                    (SCREENSHOTS / "failure-state.txt").write_text(sanitized(body))
                    if not any(secret in body for secret in PRIVATE_VALUES):
                        page.screenshot(path=str(SCREENSHOTS / "failure.png"), full_page=True)
                except Exception:
                    pass
            (SCREENSHOTS / "failure-receipt.json").write_text(json.dumps({"passed": False, "exception": type(error).__name__, "message": sanitized(error)}, indent=2))
            raise
        finally:
            stop(server)
            if media_directory.exists():
                media_directory.chmod(0o700)


if __name__ == "__main__":
    main()
