"""Invited workspace journeys against real, isolated HTTP and persisted accounts.

Build the console first. All identities and evidence are fictional. The fixture
injects an account clock for expiry, starts no collection worker, and retains
only sanitized receipts and empty-password screenshots outside its temp store.
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
from urllib.parse import urlsplit
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
with socket.socket() as reservation:
    reservation.bind(("127.0.0.1", 0))
    PORT = reservation.getsockname()[1]
BASE = f"http://127.0.0.1:{PORT}"
WORKSPACE = "fictional_invited_pilot"
OTHER_WORKSPACE = "fictional_other_workspace"
OWNER = "fixture-owner"
OWNER_PASSWORD = "Fictional-owner-bootstrap-only"
OTHER_VIEWER_PASSWORD = "Fictional-other-workspace-viewer-only"
VIEWER_PASSWORD = "Fictional-viewer-password-only"
ANALYST_PASSWORD = "Fictional-analyst-password-only"
REPLACEMENT_PASSWORD = "Fictional-replacement-password-only"
NEW_OWNER_PASSWORD = "Fictional-owner-replacement-only"
SCREENSHOTS = Path(os.environ.get("LIVELENS_SCREENSHOTS_DIR") or tempfile.mkdtemp(prefix="livelens-onboarding-"))
SCREENSHOTS.mkdir(parents=True, exist_ok=True)
PRIVATE_VALUES = {OWNER_PASSWORD, OTHER_VIEWER_PASSWORD, VIEWER_PASSWORD, ANALYST_PASSWORD, REPLACEMENT_PASSWORD, NEW_OWNER_PASSWORD}


def sanitized(value):
    text = str(value)
    for secret in sorted(PRIVATE_VALUES, key=len, reverse=True):
        text = text.replace(secret, "[private value removed]")
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


def failure_receipt(error, page):
    if page is not None:
        try:
            body = page.locator("body").inner_text()
            (SCREENSHOTS / "failure-state.txt").write_text(sanitized(body))
            for field in page.locator("input[type=password]").all():
                field.fill("")
            values = page.locator("input,textarea,select").evaluate_all("elements => elements.map(element => element.value)")
            if not any(secret in value for value in [body, *values] for secret in PRIVATE_VALUES):
                page.screenshot(path=str(SCREENSHOTS / "failure.png"), full_page=True)
        except Exception:
            pass
    (SCREENSHOTS / "failure-receipt.json").write_text(json.dumps({"fixture": True, "passed": False, "exception": type(error).__name__, "message": sanitized(error)}, indent=2))


@contextmanager
def browser_diagnostics():
    try:
        yield
    except Exception as error:
        failure_receipt(error, active_page)
        raise


def launch(directory):
    directory = Path(directory)
    entry = directory / "onboarding-fixture.mjs"
    clock = directory / "clock.txt"
    if not clock.exists():
        clock.write_text(str(int(time.time() * 1000)))
    imports = {name: (ROOT / f"services/intelligence/src/{name}.mjs").as_uri() for name in ["store", "server", "governance", "accounts"]}
    entry.write_text(f'''import {{ randomBytes }} from "node:crypto";
import {{ readFileSync, writeFileSync }} from "node:fs";
import {{ resolve }} from "node:path";
import {{ EvidenceStore }} from {json.dumps(imports["store"])};
import {{ createIntelligenceServer, SCOPES }} from {json.dumps(imports["server"])};
import {{ Governance }} from {json.dumps(imports["governance"])};
import {{ AccountDirectory }} from {json.dumps(imports["accounts"])};
const dir = process.env.LIVELENS_ONBOARDING_DIR;
const now = () => Number(readFileSync(resolve(dir, "clock.txt"), "utf8"));
const store = new EvidenceStore(resolve(dir, "evidence.sqlite"));
for (const workspace of [{json.dumps(WORKSPACE)}, "fictional_other_workspace"]) {{
  try {{ store.session(workspace, "fixture-session"); }} catch {{
    store.createSession(workspace, {{ id: "fixture-session", platform: "fixture", title: "Fictional onboarding source", sourceUrl: "https://example.invalid/fictional-onboarding", startedAtMs: now() }});
  }}
  store.append(workspace, "fixture-session", [{{ source: {{ adapter: "onboarding-fixture", eventId: "source-1" }}, kind: "chat", text: "Fictional workspace evidence; preserve original context.", account: "fictional_viewer", capturedAtMs: store.session(workspace, "fixture-session").startedAtMs }}]);
}}
try {{ store.case("fictional_other_workspace", "other-private-case"); }} catch {{
  store.createCase("fictional_other_workspace", {{ id: "other-private-case", title: "Other fictional workspace", question: "What was retained?" }}, "other-owner");
}}
const governance = new Governance({{ store, now, members: [
  {{ workspace: {json.dumps(WORKSPACE)}, subject: {json.dumps(OWNER)}, role: "owner" }},
  {{ workspace: {json.dumps(OTHER_WORKSPACE)}, subject: "fixture-viewer", role: "viewer" }}
] }});
const users = [
  {{ username: {json.dumps(OWNER)}, password: process.env.LIVELENS_ONBOARDING_PASSWORD, workspace: {json.dumps(WORKSPACE)}, scopes: SCOPES }},
  {{ username: "fixture-viewer", password: process.env.LIVELENS_ONBOARDING_OTHER_PASSWORD, workspace: {json.dumps(OTHER_WORKSPACE)}, scopes: SCOPES.filter(scope => scope.endsWith(":read")) }}
];
const accounts = new AccountDirectory({{ store, governance, scopes: SCOPES, users, now }});
const server = createIntelligenceServer({{ store, governance, accounts,
  keys: [{{ token: randomBytes(32).toString("base64url"), workspace: {json.dumps(WORKSPACE)}, subject: {json.dumps(OWNER)}, scopes: SCOPES }}],
  browser: {{ authMode: "persisted", origin: "http://127.0.0.1:" + process.env.LIVELENS_PORT, bundleDir: {json.dumps(str(ROOT / "dist"))}, users }} }});
writeFileSync(resolve(dir, "fixture-info.json"), JSON.stringify({{ otherEvidenceId: store.events("fictional_other_workspace", "fixture-session")[0].id }}));
server.listen(Number(process.env.LIVELENS_PORT), "127.0.0.1");
const close = () => {{ server.closeAllConnections(); server.close(() => {{ store.close(); process.exit(0); }}); }};
process.once("SIGTERM", close); process.once("SIGINT", close);
''')
    env = {**os.environ, "LIVELENS_ONBOARDING_DIR": str(directory), "LIVELENS_PORT": str(PORT), "LIVELENS_ONBOARDING_PASSWORD": OWNER_PASSWORD, "LIVELENS_ONBOARDING_OTHER_PASSWORD": OTHER_VIEWER_PASSWORD}
    with open(SCREENSHOTS / "fixture-server.log", "ab") as log:
        child = subprocess.Popen(["node", str(entry)], cwd=ROOT, env=env, stdout=log, stderr=log)
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError("Onboarding fixture exited; inspect its sanitized server log")
        try:
            with urlopen(BASE + "/health", timeout=1) as response:
                if response.status == 200:
                    return child
        except OSError:
            pass
        time.sleep(.1)
    stop(child)
    raise RuntimeError("Onboarding fixture did not become ready")


def request(page, path, body=None, csrf=None):
    global active_page
    active_page = page
    headers = {"Origin": BASE}
    if csrf:
        headers["x-livelens-csrf"] = csrf
    response = page.request.get(BASE + path, headers=headers) if body is None else page.request.post(BASE + path, data=body, headers=headers)
    return response


def identity(response, subject):
    assert response.status == 200, "Authenticated identity must be granted"
    data = response.json()
    assert data["workspace"] == WORKSPACE and data["subject"] == subject
    PRIVATE_VALUES.add(data["csrf"])
    return data["csrf"]


def login(page, subject, password, workspace=None, expected_status=200):
    PRIVATE_VALUES.add(password)
    page.goto(BASE + "/app/", wait_until="networkidle")
    page.get_by_label("Operator name", exact=True).fill(subject)
    page.get_by_label("Password", exact=True).fill(password)
    if workspace is not None:
        page.get_by_label("Workspace (optional)", exact=True).fill(workspace)
    with page.expect_response(lambda response: response.url.endswith("/console/login") and response.request.method == "POST") as authenticated:
        page.get_by_role("button", name="Open workspace", exact=True).click()
    assert authenticated.value.status == expected_status
    if expected_status != 200:
        assert authenticated.value.json()["error"] == "unauthorised"
        expect(page.get_by_role("alert")).to_be_visible()
        expect(page.get_by_role("heading", name="Your review desk", exact=True)).to_have_count(0)
        page.get_by_label("Password", exact=True).fill("")
        return None
    csrf = identity(authenticated.value, subject)
    page.get_by_role("heading", name="Your review desk", exact=True).wait_for()
    return csrf


def nav(page, label):
    if page.viewport_size["width"] < 800:
        page.get_by_role("button", name="Toggle navigation", exact=True).click()
    page.get_by_role("navigation", name="LiveLens navigation").get_by_role("button", name=label, exact=True).click()


def capture(page, name):
    assert page.locator("input[type=password]").evaluate_all("elements => elements.every(element => !element.value)"), "Published password fields must be empty"
    body = page.locator("body").inner_text()
    values = page.locator("input,textarea,select").evaluate_all("elements => elements.map(element => element.value)")
    assert not any(secret in value for value in [body, *values] for secret in PRIVATE_VALUES), "Private handoff values must not enter screenshots"
    page.evaluate("window.scrollTo(0, 0)")
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Onboarding must fit its viewport"
    page.screenshot(path=str(SCREENSHOTS / name), full_page=True)


def open_link(page, link, heading="Join your team."):
    PRIVATE_VALUES.update([link["token"], link["url"]])
    assert link["url"] == "/app/#invite=" + link["token"]
    page.goto(BASE + link["url"], wait_until="networkidle")
    page.get_by_role("heading", name=heading, exact=True).wait_for()
    expect(page.get_by_label("New password", exact=True)).to_be_visible()
    expect(page.get_by_label("Confirm password", exact=True)).to_be_visible()
    assert page.get_by_label("New password", exact=True).get_attribute("minlength") == "12"


def redeem(page, subject, password, reset=False):
    PRIVATE_VALUES.add(password)
    page.get_by_label("New password", exact=True).fill(password)
    page.get_by_label("Confirm password", exact=True).fill(password)
    with page.expect_response(lambda response: response.url.endswith("/console/invitations/redeem") and response.request.method == "POST") as redeemed:
        page.get_by_role("button", name="Save password and sign in" if reset else "Join workspace", exact=True).click()
    csrf = identity(redeemed.value, subject)
    page.get_by_role("heading", name="Your review desk", exact=True).wait_for()
    assert not urlsplit(page.url).fragment, "Consumed invitation fragment must be removed from the browser location"
    return csrf


def unavailable(page, token):
    PRIVATE_VALUES.add(token)
    for path, body in [("/console/invitations/inspect", {"token": token}), ("/console/invitations/redeem", {"token": token, "password": REPLACEMENT_PASSWORD})]:
        response = request(page, path, body)
        assert response.status == 400 and response.json()["error"] == "invitation_unavailable"


def assert_public_projections(owner_page):
    for path, key in [("/v1/workspace/accounts", "accounts"), ("/v1/workspace/invitations", "invitations"), ("/v1/workspace/audit", "entries")]:
        response = request(owner_page, path)
        assert response.status == 200
        encoded = json.dumps(response.json())
        assert not any(secret in encoded for secret in PRIVATE_VALUES), "Account metadata/audit must omit raw handoff values"
        assert not re.search(r'"(?:token|token_hash|password_hash|password_salt|credential_version)"\s*:', encoded), "Private credential internals must not be projected"


def create_invitation(owner_page, username, role, hours=1):
    global active_page
    active_page = owner_page
    owner_page.get_by_label("New operator name", exact=True).fill(username)
    owner_page.get_by_label("Invitation role", exact=True).select_option(role)
    owner_page.get_by_label("Link lifetime (hours)", exact=True).fill(str(hours))
    owner_page.get_by_label("Invitation reason", exact=True).fill("Explicit fictional invited-pilot acceptance")
    with owner_page.expect_response(lambda response: response.url.endswith("/v1/workspace/invitations") and response.request.method == "POST") as created:
        owner_page.get_by_role("button", name="Create invitation", exact=True).click()
    assert created.value.status == 201
    link = created.value.json()
    PRIVATE_VALUES.update([link["token"], link["url"], BASE + link["url"]])
    invitation = link["invitation"]
    assert invitation["workspace"] == WORKSPACE and invitation["username"] == username
    assert invitation["role"] == role and invitation["state"] == "pending"
    expect(owner_page.get_by_label("Invitation link", exact=True)).to_have_value(BASE + link["url"])
    owner_page.get_by_role("button", name="Copy invitation link", exact=True).click()
    assert owner_page.evaluate("navigator.clipboard.readText()") == BASE + link["url"], "Copy must hand off the actual invitation"
    owner_page.get_by_role("button", name="Dismiss link", exact=True).click()
    expect(owner_page.get_by_label("Invitation link", exact=True)).to_have_count(0)
    return link


def reset_link(owner_page, username):
    global active_page
    active_page = owner_page
    with owner_page.expect_response(lambda response: response.url.endswith("/v1/workspace/accounts") and response.request.method == "GET") as refreshed:
        owner_page.get_by_role("button", name="Refresh records", exact=True).click()
    assert refreshed.value.status == 200
    owner_page.get_by_role("button", name=f"Reset password for {username}", exact=True).click()
    owner_page.get_by_label("Access change reason", exact=True).fill("Fictional password recovery acceptance")
    with owner_page.expect_response(lambda response: response.url.endswith(f"/v1/workspace/accounts/{username}/reset") and response.request.method == "POST") as reset:
        owner_page.get_by_role("button", name="Create reset link", exact=True).click()
    assert reset.value.status == 201
    link = reset.value.json()
    PRIVATE_VALUES.update([link["token"], link["url"], BASE + link["url"]])
    assert link["invitation"]["purpose"] == "password-reset"
    assert link["invitation"]["username"] == username
    return link


with tempfile.TemporaryDirectory(prefix="livelens-onboarding-data-") as directory:
    server = None
    active_page = None
    try:
        server = launch(directory)
        with sync_playwright() as playwright, browser_diagnostics():
            browser = playwright.chromium.launch(executable_path=os.environ.get("LIVELENS_CHROMIUM", "/usr/bin/chromium"), headless=True)
            errors = []
            request_urls = []

            def new_page(phone=False):
                context = browser.new_context(viewport={"width": 390 if phone else 1440, "height": 844 if phone else 1024}, permissions=["clipboard-read", "clipboard-write"])
                page = context.new_page()
                page.set_default_timeout(15000)
                page.on("pageerror", lambda error: errors.append(sanitized(error)))
                page.on("request", lambda req: request_urls.append(req.url))
                return page

            owner_page = new_page()
            active_page = owner_page
            owner_csrf = login(owner_page, OWNER, OWNER_PASSWORD)
            caps = request(owner_page, "/v1/capabilities").json()
            assert {"persisted-browser-accounts", "workspace-invitations"}.issubset(caps["enabled"])
            nav(owner_page, "Workspace & access")
            owner_page.get_by_role("button", name="Members", exact=True).click()
            owner_page.get_by_label("New operator name", exact=True).wait_for()
            capture(owner_page, "01-desktop-owner-invitation-form.png")

            viewer_link = create_invitation(owner_page, "fixture-viewer", "viewer")
            analyst_link = create_invitation(owner_page, "fixture-analyst", "analyst")
            viewer_page = new_page(phone=True)
            active_page = viewer_page
            open_link(viewer_page, viewer_link)
            expect(viewer_page.locator(".ll-login-card")).to_contain_text(WORKSPACE)
            expect(viewer_page.locator(".ll-login-card")).to_contain_text("Workspace role: viewer.")
            capture(viewer_page, "02-phone-invitation-empty-password.png")
            viewer_page.get_by_label("New password", exact=True).focus()
            viewer_page.keyboard.press("Tab")
            expect(viewer_page.get_by_label("Confirm password", exact=True)).to_be_focused()

            duplicate_page = new_page()
            open_link(duplicate_page, viewer_link)
            short = request(duplicate_page, "/console/invitations/redeem", {"token": viewer_link["token"], "password": "short"})
            assert short.status == 400 and short.json()["error"] == "password_too_short"
            viewer_csrf = redeem(viewer_page, "fixture-viewer", VIEWER_PASSWORD)
            # The second context already inspected the formerly valid link.
            duplicate_page.get_by_label("New password", exact=True).fill(REPLACEMENT_PASSWORD)
            duplicate_page.get_by_label("Confirm password", exact=True).fill(REPLACEMENT_PASSWORD)
            with duplicate_page.expect_response(lambda response: response.url.endswith("/console/invitations/redeem")) as reused:
                duplicate_page.get_by_role("button", name="Join workspace", exact=True).click()
            assert reused.value.status == 400 and reused.value.json()["error"] == "invitation_unavailable"
            expect(duplicate_page.get_by_role("alert")).to_be_visible()
            expect(duplicate_page.get_by_label("New password", exact=True)).to_have_value("")
            expect(duplicate_page.get_by_label("Confirm password", exact=True)).to_have_value("")
            unavailable(duplicate_page, viewer_link["token"])

            viewer_caps = request(viewer_page, "/v1/capabilities").json()
            assert viewer_caps["workspace"] == WORKSPACE and viewer_caps["subject"] == "fixture-viewer"
            assert "cases:read" in viewer_caps["scopes"] and "cases:write" not in viewer_caps["scopes"]
            assert request(viewer_page, "/v1/workspace").json()["role"] == "viewer"
            assert request(viewer_page, "/v1/sessions").json()["sessions"][0]["title"] == "Fictional onboarding source"
            denied = request(viewer_page, "/v1/cases", {"title": "Must not persist", "question": "Viewer write must be denied"}, viewer_csrf)
            assert denied.status == 403 and denied.json()["error"] == "scope_denied"
            assert request(viewer_page, "/v1/workspace/accounts").status == 403
            other_id = json.loads((Path(directory) / "fixture-info.json").read_text())["otherEvidenceId"]
            assert request(viewer_page, f"/v1/evidence/{other_id}/context").status == 404
            assert request(viewer_page, "/v1/cases/other-private-case").status == 404
            nav(viewer_page, "Workspace & access")
            viewer_page.get_by_role("button", name="Members", exact=True).click()
            expect(viewer_page.get_by_label("New operator name", exact=True)).to_have_count(0)
            capture(viewer_page, "03-phone-viewer-workspace.png")

            analyst_page = new_page()
            active_page = analyst_page
            open_link(analyst_page, analyst_link)
            analyst_csrf = redeem(analyst_page, "fixture-analyst", ANALYST_PASSWORD)
            assert request(analyst_page, "/v1/workspace").json()["role"] == "analyst"
            assert "cases:write" in request(analyst_page, "/v1/capabilities").json()["scopes"]
            nav(analyst_page, "Investigations")
            analyst_page.get_by_role("button", name="New investigation", exact=True).click()
            analyst_page.get_by_label("Investigation name", exact=True).fill("Fictional invited analyst investigation")
            analyst_page.get_by_label("Question", exact=True).fill("Can an invited analyst preserve an actual investigation?")
            with analyst_page.expect_response(lambda response: response.url.endswith("/v1/cases") and response.request.method == "POST") as created_case:
                analyst_page.get_by_role("button", name="Create investigation", exact=True).click()
            assert created_case.value.status == 201
            created_case_id = created_case.value.json()["id"]
            analyst_page.get_by_role("heading", name="Fictional invited analyst investigation", exact=True).wait_for()
            capture(analyst_page, "04-desktop-invited-analyst-investigation.png")

            # Leave a real editable form open while another context removes write access.
            analyst_page.get_by_role("button", name="All investigations", exact=True).click()
            analyst_page.get_by_role("button", name="New investigation", exact=True).click()
            analyst_page.get_by_label("Investigation name", exact=True).fill("Stale role write must not persist")
            analyst_page.get_by_label("Question", exact=True).fill("Does current role constrain an already open form?")
            owner_page.get_by_label("Member identifier", exact=True).fill("fixture-analyst")
            owner_page.get_by_label("Workspace role", exact=True).select_option("viewer")
            with owner_page.expect_response(lambda response: response.url.endswith("/v1/workspace/members") and response.request.method == "POST") as changed:
                owner_page.get_by_role("button", name="Save member role", exact=True).click()
            assert changed.value.status == 201
            with analyst_page.expect_response(lambda response: response.url.endswith("/v1/cases") and response.request.method == "POST") as stale_write:
                analyst_page.get_by_role("button", name="Create investigation", exact=True).click()
            assert stale_write.value.status == 403 and stale_write.value.json()["error"] == "scope_denied"
            expect(analyst_page.get_by_role("alert")).to_be_visible()
            assert "Investigation created." not in analyst_page.locator("body").inner_text()
            assert request(analyst_page, "/v1/workspace").json()["role"] == "viewer"
            assert "cases:write" not in request(analyst_page, "/v1/capabilities").json()["scopes"]
            cases = request(owner_page, "/v1/cases").json()["cases"]
            assert len(cases) == 1 and cases[0]["id"] == created_case_id
            analyst_page.reload(wait_until="networkidle")
            nav(analyst_page, "Workspace & access")
            analyst_page.get_by_role("button", name="Members", exact=True).click()
            expect(analyst_page.get_by_label("New operator name", exact=True)).to_have_count(0)
            capture(analyst_page, "05-desktop-role-downgrade.png")

            # Password recovery invalidates two existing cookies immediately,
            # then preserves current workspace/role when redeemed in a third context.
            second_analyst_page = new_page()
            second_analyst_csrf = login(second_analyst_page, "fixture-analyst", ANALYST_PASSWORD)
            analyst_reset = reset_link(owner_page, "fixture-analyst")
            owner_page.get_by_role("button", name="Dismiss link", exact=True).click()
            for old_page, old_csrf in [(analyst_page, analyst_csrf), (second_analyst_page, second_analyst_csrf)]:
                assert request(old_page, "/console/session").status == 401
                assert request(old_page, "/v1/sessions").status == 401
                assert request(old_page, "/v1/cases", {"title": "Reset stale cookie", "question": "Must be denied"}, old_csrf).status == 401
            assert request(duplicate_page, "/console/login", {"username": "fixture-analyst", "password": ANALYST_PASSWORD}).status == 401
            recovered_page = new_page()
            active_page = recovered_page
            open_link(recovered_page, analyst_reset, "Set a new password.")
            capture(recovered_page, "06-desktop-reset-empty-password.png")
            recovered_csrf = redeem(recovered_page, "fixture-analyst", REPLACEMENT_PASSWORD, reset=True)
            assert request(recovered_page, "/v1/workspace").json()["role"] == "viewer"
            unavailable(duplicate_page, analyst_reset["token"])

            owner_page.get_by_role("button", name="Revoke access for fixture-analyst", exact=True).click()
            owner_page.get_by_label("Access change reason", exact=True).fill("Fictional pilot access revoked after recovery")
            with owner_page.expect_response(lambda response: response.url.endswith("/v1/workspace/accounts/fixture-analyst/revoke")) as revoked:
                owner_page.get_by_role("button", name="Confirm revocation", exact=True).click()
            assert revoked.value.status == 200 and revoked.value.json()["account"]["role"] == "revoked"
            assert request(recovered_page, "/console/session").status == 401
            assert request(recovered_page, "/v1/sessions").status == 401
            assert request(recovered_page, "/v1/cases", {"title": "Revoked stale cookie", "question": "Must be denied"}, recovered_csrf).status == 401
            recovered_page.reload(wait_until="networkidle")
            expect(recovered_page.get_by_label("Operator name", exact=True)).to_be_visible()
            expect(recovered_page.get_by_role("heading", name="Your review desk", exact=True)).to_have_count(0)

            revoked_link = create_invitation(owner_page, "fixture-revoked-invite", "viewer")
            owner_page.get_by_role("button", name="Revoke invitation for fixture-revoked-invite", exact=True).click()
            owner_page.get_by_label("Access change reason", exact=True).fill("Fictional unused invitation explicitly revoked")
            with owner_page.expect_response(lambda response: response.url.endswith(f"/v1/workspace/invitations/{revoked_link['invitation']['id']}/revoke")) as revoke_link:
                owner_page.get_by_role("button", name="Confirm revocation", exact=True).click()
            assert revoke_link.value.status == 200
            unavailable(duplicate_page, revoked_link["token"])
            expired_link = create_invitation(owner_page, "fixture-expired-invite", "viewer")
            clock = Path(directory) / "clock.txt"
            clock.write_text(str(int(clock.read_text()) + 3_600_001))
            unavailable(duplicate_page, expired_link["token"])
            states = {item["username"]: item["state"] for item in request(owner_page, "/v1/workspace/invitations").json()["invitations"] if item["purpose"] == "invite"}
            assert states["fixture-viewer"] == "used" and states["fixture-analyst"] == "used"
            assert states["fixture-revoked-invite"] == "revoked" and states["fixture-expired-invite"] == "expired"
            assert_public_projections(owner_page)

            # Reset the configured bootstrap owner, then restart with unchanged
            # bootstrap input: persisted recovery must not restore the seed password.
            owner_reset = reset_link(owner_page, OWNER)
            assert request(owner_page, "/console/session").status == 401
            assert request(owner_page, "/v1/cases", {"title": "Old owner cookie", "question": "Must be denied"}, owner_csrf).status == 401
            new_owner_page = new_page()
            active_page = new_owner_page
            open_link(new_owner_page, owner_reset, "Set a new password.")
            redeem(new_owner_page, OWNER, NEW_OWNER_PASSWORD, reset=True)
            assert request(new_owner_page, "/v1/workspace").json()["role"] == "owner"
            stop(server)
            server = launch(directory)
            assert request(new_owner_page, "/console/session").status == 401, "Browser cookie sessions must not outlive service restart"
            restarted_owner_page = new_page()
            active_page = restarted_owner_page
            assert request(restarted_owner_page, "/console/login", {"username": OWNER, "password": OWNER_PASSWORD}).status == 401
            login(restarted_owner_page, OWNER, NEW_OWNER_PASSWORD)
            restarted_viewer_page = new_page()
            login(restarted_viewer_page, "fixture-viewer", VIEWER_PASSWORD, expected_status=401)
            assert request(restarted_viewer_page, "/console/session").status == 401
            login(restarted_viewer_page, "fixture-viewer", VIEWER_PASSWORD, workspace=WORKSPACE)
            assert request(restarted_viewer_page, "/v1/workspace").json()["role"] == "viewer"
            assert request(restarted_viewer_page, "/v1/cases").json()["cases"][0]["id"] == created_case_id
            assert request(restarted_viewer_page, "/v1/cases/other-private-case").status == 404
            assert request(duplicate_page, "/console/login", {"username": "fixture-analyst", "password": REPLACEMENT_PASSWORD}).status == 401
            unavailable(duplicate_page, viewer_link["token"])
            unavailable(duplicate_page, owner_reset["token"])
            accounts = request(restarted_owner_page, "/v1/workspace/accounts").json()["accounts"]
            assert len(accounts) == 3 and {account["username"] for account in accounts} == {OWNER, "fixture-viewer", "fixture-analyst"}
            assert next(account for account in accounts if account["username"] == "fixture-analyst")["role"] == "revoked"
            assert len([member for member in request(restarted_owner_page, "/v1/workspace/members").json()["members"] if member["role"] == "owner"]) == 1
            assert_public_projections(restarted_owner_page)
            nav(restarted_owner_page, "Workspace & access")
            restarted_owner_page.get_by_role("button", name="Members", exact=True).click()
            restarted_owner_page.get_by_label("New operator name", exact=True).wait_for()
            capture(restarted_owner_page, "07-desktop-persisted-accounts.png")
            assert not errors, "Invited operator journeys must have zero uncaught page errors"
            assert not any(secret in url for url in request_urls for secret in PRIVATE_VALUES), "Credentials and invitation tokens must not appear in HTTP request URLs"
            for path in Path(directory).glob("evidence.sqlite*"):
                raw = path.read_bytes()
                assert not any(secret.encode() in raw for secret in PRIVATE_VALUES), "Passwords and raw invitation tokens must not persist in the database"
            receipt = {
                "fixture": True, "externalLiveValidated": False,
                "actualPersistedAccounts": True, "ownerCreatesViewerAndAnalystInBrowser": True,
                "privateLinkClipboardAndFragment": True, "desktop1440AndPhone390": True,
                "keyboardFormNavigation": True, "minimumPasswordEnforced": True,
                "correctWorkspaceAndRole": True, "crossWorkspaceResourcesDenied": True,
                "viewerWriteDenied403": True, "analystCreatesActualInvestigation": True,
                "sameSessionRoleDowngradeWriteDenied": True, "noStaleWritePersisted": True,
                "passwordResetInvalidatesMultipleCookies": True, "singleUseLinks": True,
                "expiredAndRevokedLinksDenied": True, "revokedIdentityCannotRead": True,
                "serviceRestartCredentialsPersist": True, "bootstrapPasswordNotRestored": True,
                "ambiguousUsernameDenied401": True, "explicitWorkspaceBrowserLoginBound": True,
                "accountMetadataAuditAndDatabaseOmitRawSecrets": True,
                "uncaughtPageErrors": len(errors), "screenshots": str(SCREENSHOTS),
            }
            (SCREENSHOTS / "receipt.json").write_text(json.dumps(receipt, indent=2))
            print(json.dumps(receipt))
            browser.close()
    except Exception as error:
        if not (SCREENSHOTS / "failure-receipt.json").exists():
            failure_receipt(error, None)
        raise RuntimeError(sanitized(error)) from None
    finally:
        stop(server)
