import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceStore } from "../src/store.mjs";
import { InvestigationEngine } from "../src/investigations.mjs";
import { Governance } from "../src/governance.mjs";
import { createIntelligenceServer, SCOPES } from "../src/server.mjs";
import { digest } from "../src/validation.mjs";

// These tests exercise complete HTTP journeys with real persistent engines. All
// accounts, quotations, credentials and source URLs here are fictional fixtures.
const tokens = Object.fromEntries(
  ["owner", "analyst", "viewer", "reader", "foreign"].map((name, index) => [
    name,
    String(index + 1).repeat(40),
  ]),
);
const members = [
  { workspace: "alpha", subject: "owner", role: "owner" },
  { workspace: "alpha", subject: "analyst", role: "analyst" },
  { workspace: "alpha", subject: "viewer", role: "viewer" },
  { workspace: "alpha", subject: "reader", role: "analyst" },
  { workspace: "beta", subject: "foreign", role: "owner" },
];

async function fixture(t, { pdf } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "livelens-full-http-"));
  let server, store, governance, origin;
  const start = async () => {
    store = new EvidenceStore(join(directory, "evidence.sqlite"));
    governance = new Governance({ store, members });
    server = createIntelligenceServer({
      store,
      governance,
      investigation: new InvestigationEngine({ store }),
      pdf,
      keys: Object.entries(tokens).map(([subject, token]) => ({
        token,
        subject,
        workspace: subject === "foreign" ? "beta" : "alpha",
        scopes:
          subject === "reader"
            ? SCOPES.filter((scope) => scope.endsWith(":read"))
            : SCOPES,
      })),
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => {
    if (server?.listening) {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
    }
    store?.close();
  };
  t.after(async () => {
    await stop();
    rmSync(directory, { recursive: true, force: true });
  });
  await start();
  const response = (path, { actor = "owner", method = "GET", body } = {}) =>
    fetch(origin + path, {
      method,
      headers: {
        Authorization: `Bearer ${tokens[actor]}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const request = async (path, { expected = 200, ...options } = {}) => {
    const result = await response(path, options);
    const value = await result.json();
    assert.equal(
      result.status,
      expected,
      `${options.method ?? "GET"} ${path}: ${JSON.stringify(value)}`,
    );
    return value;
  };
  return {
    request,
    response,
    restart: async () => {
      await stop();
      await start();
    },
    get governance() {
      return governance;
    },
  };
}

async function seed(f) {
  const start = 1_700_000_000_000;
  for (const id of ["session", "later"])
    await f.request("/v1/sessions", {
      method: "POST",
      expected: 201,
      body: {
        id,
        platform: "fixture",
        account: "fictional_host",
        title: `Fictional ${id}`,
        sourceUrl: `https://example.invalid/${id}`,
        startedAtMs: start,
      },
    });
  const events = await f.request("/v1/sessions/session/events", {
    method: "POST",
    body: {
      events: [
        {
          source: { adapter: "fixture", eventId: "claim" },
          kind: "chat",
          text: "@fictional_target warning: the quotation needs context.",
          account: "fictional_viewer",
          sourceTimestampMs: start + 1000,
          capturedAtMs: start + 1050,
          raw: { original: "retained" },
        },
        {
          source: { adapter: "fixture", eventId: "counter" },
          kind: "chat",
          text: "The warning was a fictional safety example, not an allegation.",
          account: "fictional_host",
          sourceTimestampMs: null,
          capturedAtMs: start + 2100,
        },
        {
          source: { adapter: "fixture", eventId: "gap" },
          kind: "gap",
          text: "Fixture capture interruption; no missing speech was inferred.",
          capturedAtMs: start + 2200,
        },
      ],
    },
  });
  await f.request("/v1/sessions/later/events", {
    method: "POST",
    body: {
      events: [
        {
          source: { adapter: "fixture", eventId: "later-context" },
          kind: "chat",
          text: "The fictional warning has been clarified.",
          account: "fictional_viewer",
          capturedAtMs: start + 3000,
        },
      ],
    },
  });
  await f.request("/v1/cases", {
    method: "POST",
    expected: 201,
    body: {
      id: "case",
      title: "Fictional context review",
      question: "What does the source support and what challenges it?",
    },
  });
  return events.results.map((result) => result.evidence);
}

test("an operator investigates sources, reviews conflicting evidence, runs a mission and reopens a redacted brief after restart", async (t) => {
  const f = await fixture(t),
    [claim, counter, gap] = await seed(f);
  await f.request("/v1/cases/case/evidence", {
    method: "POST",
    body: { evidenceIds: [claim.id, counter.id, gap.id] },
  });
  const note = await f.request("/v1/investigations/case/notes", {
    method: "POST",
    expected: 201,
    body: {
      text: "Read the original and its conflicting explanation together.",
      evidenceIds: [claim.id, counter.id],
    },
  });
  assert.equal(note.reviewer, "owner");
  await f.request("/v1/bookmarks", {
    method: "POST",
    expected: 201,
    body: { evidenceId: claim.id, label: "Reopen original quotation" },
  });
  const finding = await f.request("/v1/investigations/case/findings", {
    method: "POST",
    expected: 201,
    actor: "analyst",
    body: {
      id: "finding",
      title: "Quotation requires context",
      statement:
        "A warning was captured, while nearby context challenges an allegation.",
      supportEvidenceIds: [claim.id],
      counterEvidenceIds: [counter.id],
      topic: "context",
    },
  });
  assert.equal(finding.status, "draft");
  const reviewed = await f.request(
    "/v1/investigations/case/findings/finding/review",
    {
      method: "POST",
      expected: 201,
      body: {
        status: "reviewed",
        reason: "Checked the original and the conflicting explanation.",
        expectedRevision: finding.revision,
      },
    },
  );
  assert.equal(reviewed.history[0].reviewer, "analyst");
  assert.equal(reviewed.history[1].reviewer, "owner");
  await f.request("/v1/investigations/case/findings/finding/review", {
    method: "POST",
    expected: 409,
    body: {
      status: "rejected",
      reason: "A stale edit must not overwrite the review.",
      expectedRevision: 1,
    },
  });

  const relation = await f.request("/v1/graph", {
    method: "POST",
    expected: 201,
    body: {
      from: { kind: "account", id: "fictional_viewer" },
      to: { kind: "topic", id: "context" },
      label: "discussed captured context",
      status: "operator-reviewed",
      evidenceIds: [claim.id, counter.id],
      reason:
        "This links observed source material; it does not infer identity or coordination.",
    },
  });
  const graph = await f.request("/v1/graph");
  assert.ok(
    graph.edges.some(
      (edge) => edge.id === relation.id && edge.evidenceIds.includes(claim.id),
    ),
  );
  const comparison = await f.request("/v1/comparisons", {
    method: "POST",
    expected: 201,
    body: {
      sessionIds: ["session", "later"],
      terms: ["warning"],
      account: "fictional_viewer",
    },
  });
  assert.equal(comparison.sessions.length, 2);
  assert.equal(
    comparison.sessions[0].topics[0].quotations[0].evidenceId,
    claim.id,
  );
  const activity = await f.request("/v1/accounts/fictional_viewer/activity");
  assert.equal(activity.sessions.length, 2);

  await f.request("/v1/missions", {
    method: "POST",
    expected: 201,
    body: {
      id: "mission",
      title: "Fictional protection review",
      protectedAccount: "fictional_target",
      sessionIds: ["session"],
      rules: [
        {
          label: "Warning in context",
          terms: ["@fictional_target", "warning"],
          match: "all",
          contextTerms: ["context"],
        },
      ],
    },
  });
  const run = await f.request("/v1/missions/mission/run", {
    method: "POST",
    expected: 201,
    body: {},
  });
  assert.equal(run.created, 1);
  assert.equal(run.alerts[0].evidenceId, claim.id);
  assert.ok(run.alerts[0].gapEvidenceIds.includes(gap.id));
  assert.equal(
    (
      await f.request("/v1/missions/mission/run", {
        method: "POST",
        expected: 201,
        body: {},
      })
    ).created,
    0,
    "Rerunning an unchanged rule must not duplicate alerts",
  );
  await f.request(`/v1/alerts/${run.alerts[0].id}/review`, {
    method: "POST",
    expected: 201,
    body: {
      status: "dismissed",
      reason:
        "The nearby fictional safety explanation changes the interpretation.",
    },
  });

  await f.request("/v1/investigations/case/report", {
    method: "POST",
    expected: 201,
    body: {
      title: "Reviewed fictional context brief",
      summary:
        "The reviewed finding retains support, challenge and capture uncertainty.",
      redactions: [
        {
          evidenceId: claim.id,
          text: true,
          account: true,
          reason: "Prepare a redacted quotation copy.",
        },
      ],
      reason: "First reviewed release.",
      expectedRevision: 0,
    },
  });
  await f.restart();
  const detail = await f.request("/v1/investigations/case");
  assert.equal(detail.notes[0].text, note.text);
  assert.equal(detail.findings[0].status, "reviewed");
  assert.deepEqual(detail.findings[0].counterEvidenceIds, [counter.id]);
  assert.equal(detail.findings[0].history.length, 2);
  assert.equal(
    (await f.request("/v1/bookmarks")).bookmarks[0].evidenceId,
    claim.id,
  );
  assert.equal((await f.request("/v1/alerts")).alerts[0].status, "dismissed");
  assert.ok(
    (await f.request("/v1/graph")).edges.some(
      (edge) => edge.id === relation.id,
    ),
  );
  const report = await f.request("/v1/investigations/case/report?format=json");
  const redacted = report.evidence.find((event) => event.id === claim.id);
  assert.equal(redacted.text, "[Text redacted in this report copy]");
  assert.equal(redacted.account, null);
  assert.equal(redacted.attribution.account, null);
  assert.deepEqual(redacted.raw, {});
  assert.ok(
    !JSON.stringify(report).includes(claim.text),
    "Share-copy redaction must cover repeated quotations",
  );
  assert.ok(
    !JSON.stringify(report).includes(claim.account),
    "Share-copy redaction must cover dependent account provenance",
  );
  assert.ok(
    !JSON.stringify(report).includes(note.text),
    "A note referencing a redacted quotation must not disclose its interpretation",
  );
  assert.equal(
    report.manifest.evidence.find((event) => event.id === claim.id)
      .payloadSha256,
    claim.integrity.payloadSha256,
  );
  const { reportSha256, ...payload } = report;
  assert.equal(
    reportSha256,
    digest(payload),
    "The download must verify its complete contents",
  );
  const original = await f.request(`/v1/evidence/${claim.id}`);
  assert.equal(original.text, claim.text);
  assert.equal(original.account, claim.account);
  assert.equal(original.sourceTimestampMs, claim.sourceTimestampMs);
  assert.equal(
    (await f.request(`/v1/evidence/${counter.id}`)).sourceTimestampMs,
    null,
  );
  const markdown = await f.response(
    "/v1/investigations/case/report?format=markdown",
  );
  assert.equal(markdown.status, 200);
  assert.match(await markdown.text(), /Counterevidence:/);
  const html = await f.response("/v1/investigations/case/report?format=html");
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Redacted copy/);
  assert.equal(f.governance.verifyAudit("alpha").valid, true);
});

test("API scope, workspace role, case grants and durable revocation independently constrain the same HTTP tools", async (t) => {
  const f = await fixture(t),
    [claim] = await seed(f);
  const scopedWrites = [
    ["/v1/investigations/case/notes", { text: "Disallowed write" }],
    ["/v1/bookmarks", { evidenceId: claim.id, label: "Disallowed bookmark" }],
    ["/v1/missions", { title: "Disallowed mission" }],
    [
      "/v1/investigations/case/report",
      { title: "Disallowed report", reason: "Read token" },
    ],
    ["/v1/workspace/members", { subject: "reader", role: "owner" }],
  ];
  for (const [path, body] of scopedWrites)
    assert.equal(
      (
        await f.request(path, {
          actor: "reader",
          method: "POST",
          expected: 403,
          body,
        })
      ).error,
      "scope_denied",
    );
  assert.equal(
    (
      await f.request("/v1/investigations/case/notes", {
        actor: "viewer",
        method: "POST",
        expected: 403,
        body: { text: "A broad token cannot override a viewer role." },
      })
    ).error,
    "workspace_role_denied",
  );
  assert.equal(
    (
      await f.request("/v1/workspace/members", {
        actor: "analyst",
        method: "POST",
        expected: 403,
        body: { subject: "analyst", role: "owner" },
      })
    ).error,
    "workspace_admin_required",
  );
  assert.equal(
    (
      await f.request("/v1/bookmarks", {
        actor: "foreign",
        method: "POST",
        expected: 404,
        body: { evidenceId: claim.id, label: "Foreign evidence" },
      })
    ).error,
    "evidence_not_found",
  );
  assert.deepEqual(
    (await f.request("/v1/graph", { actor: "foreign" })).edges,
    [],
  );
  assert.deepEqual(
    (await f.request("/v1/alerts", { actor: "foreign" })).alerts,
    [],
  );
  await f.request("/v1/investigations/case/notes", {
    method: "POST",
    expected: 400,
    body: { text: "Cannot choose a tenant", workspace: "beta" },
  });

  await f.request("/v1/workspace/cases/case/access", {
    method: "POST",
    expected: 201,
    body: {
      visibility: "restricted",
      reason: "Limit this sensitive fictional review.",
    },
  });
  assert.equal(
    (
      await f.request("/v1/investigations/case", {
        actor: "analyst",
        expected: 403,
      })
    ).error,
    "case_access_denied",
  );
  assert.deepEqual(
    (await f.request("/v1/cases", { actor: "analyst" })).cases,
    [],
  );
  assert.equal(
    (await f.request("/v1/overview", { actor: "analyst" })).cases,
    0,
  );
  await f.request("/v1/workspace/cases/case/access", {
    method: "POST",
    expected: 201,
    body: {
      subject: "analyst",
      permission: "read",
      reason: "Permit source review only.",
    },
  });
  assert.equal(
    (await f.request("/v1/investigations/case", { actor: "analyst" })).case.id,
    "case",
  );
  assert.equal(
    (
      await f.request("/v1/investigations/case/notes", {
        actor: "analyst",
        method: "POST",
        expected: 403,
        body: { text: "Read grant does not grant edits." },
      })
    ).error,
    "case_access_denied",
  );
  await f.request("/v1/workspace/cases/case/access", {
    method: "POST",
    expected: 201,
    body: {
      subject: "analyst",
      permission: "write",
      reason: "Permit a reviewed correction.",
    },
  });
  await f.request("/v1/investigations/case/notes", {
    actor: "analyst",
    method: "POST",
    expected: 201,
    body: { text: "Granted correction." },
  });
  await f.request("/v1/workspace/members", {
    method: "POST",
    expected: 201,
    body: { subject: "analyst", role: "revoked" },
  });
  assert.equal(
    (
      await f.request("/v1/investigations/case", {
        actor: "analyst",
        expected: 403,
      })
    ).error,
    "workspace_membership_denied",
  );
  await f.restart();
  assert.equal(
    (
      await f.request("/v1/evidence/search", {
        actor: "analyst",
        expected: 403,
      })
    ).error,
    "workspace_membership_denied",
  );
  assert.equal(
    (await f.request("/v1/capabilities", { actor: "analyst", expected: 403 }))
      .error,
    "workspace_membership_denied",
  );
  assert.equal(
    (await f.request("/v1/workspace/members")).members.find(
      (member) => member.subject === "analyst",
    ).role,
    "revoked",
    "Configuration seeds must not silently undo a revocation",
  );
  assert.equal(
    (
      await f.request("/v1/workspace/members", {
        method: "POST",
        expected: 409,
        body: { subject: "owner", role: "viewer" },
      })
    ).error,
    "last_workspace_owner",
  );
  assert.equal(f.governance.verifyAudit("alpha").valid, true);
});

const pdf =
  process.env.LIVELENS_TEST_PDF_PYTHON && process.env.LIVELENS_TEST_PDF_CHROMIUM
    ? {
        python: process.env.LIVELENS_TEST_PDF_PYTHON,
        chromium: process.env.LIVELENS_TEST_PDF_CHROMIUM,
      }
    : null;
test(
  "configured PDF export returns a real offline-rendered document for a persisted reviewed brief",
  {
    skip:
      !pdf &&
      "Set LIVELENS_TEST_PDF_PYTHON and LIVELENS_TEST_PDF_CHROMIUM to validate the real renderer.",
  },
  async (t) => {
    const f = await fixture(t, { pdf }),
      [claim] = await seed(f);
    await f.request("/v1/cases/case/evidence", {
      method: "POST",
      body: { evidenceIds: [claim.id] },
    });
    await f.request("/v1/investigations/case/report", {
      method: "POST",
      expected: 201,
      body: {
        title: "Fictional offline PDF",
        summary: "A source-supported reviewed fixture.",
        reason: "Prepare the PDF receipt.",
      },
    });
    await f.restart();
    const response = await f.response(
      "/v1/investigations/case/report?format=pdf",
    );
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.match(
      response.headers.get("content-disposition"),
      /livelens-case\.pdf/,
    );
    const document = Buffer.from(await response.arrayBuffer());
    assert.equal(document.subarray(0, 5).toString(), "%PDF-");
    assert.ok(document.length > 2000);
    assert.match(document.subarray(-100).toString(), /%%EOF/);
  },
);
