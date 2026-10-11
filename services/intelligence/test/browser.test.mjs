import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as reserveServer } from "node:net";
import { EvidenceStore } from "../src/store.mjs";
import { createIntelligenceServer, SCOPES } from "../src/server.mjs";

async function fixture(t) {
  const store = new EvidenceStore();
  for (const w of ["alpha", "beta"])
    store.createSession(w, {
      id: "session",
      platform: "fixture",
      sourceUrl: "https://example.invalid/live",
      title: w,
      startedAtMs: 1,
    });
  const reservation = reserveServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const origin = "http://127.0.0.1:" + port;
  const server = createIntelligenceServer({
    store,
    keys: [
      {
        token: "a".repeat(40),
        workspace: "alpha",
        subject: "collector",
        scopes: SCOPES,
      },
    ],
    browser: {
      origin,
      users: [
        {
          username: "operator",
          password: "fixture-password-only",
          workspace: "alpha",
          scopes: [
            "sessions:read",
            "evidence:read",
            "cases:read",
            "cases:write",
          ],
        },
      ],
    },
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
  });
  const url = "http://127.0.0.1:" + server.address().port;
  const request = (
    path,
    {
      method = "GET",
      body,
      cookie,
      csrf,
      origin,
      host = "127.0.0.1:" + port,
      token,
    } = {},
  ) =>
    fetch(url + path, {
      method,
      headers: {
        Host: host,
        ...(origin ? { Origin: origin } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { "X-LiveLens-CSRF": csrf } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = await request("/console/login", {
    method: "POST",
    origin,
    body: { username: "operator", password: "fixture-password-only" },
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  const body = await login.json();
  return {
    request,
    store,
    cookie: login.headers.get("set-cookie").split(";")[0],
    csrf: body.csrf,
    origin,
  };
}
test("browser session grants only configured workspace and scopes; bearer browser requests stay refused", async (t) => {
  const { request, cookie, origin } = await fixture(t);
  assert.equal((await request("/v1/sessions")).status, 401);
  const response = await request("/v1/sessions", { cookie });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sessions[0].title, "alpha");
  assert.equal(
    (await request("/v1/sessions", { cookie, origin: "https://evil.invalid" }))
      .status,
    403,
  );
  assert.equal(
    (await request("/v1/sessions", { origin, token: "a".repeat(40) })).status,
    403,
  );
});
test("case writes require same-origin CSRF, and logout revokes the session", async (t) => {
  const { request, cookie, csrf, origin } = await fixture(t);
  const body = { title: "Fixture case", question: "What was captured?" };
  assert.equal(
    (await request("/v1/cases", { cookie, method: "POST", body })).status,
    403,
  );
  assert.equal(
    (await request("/v1/cases", { cookie, origin, method: "POST", body }))
      .status,
    403,
  );
  assert.equal(
    (await request("/v1/cases", { cookie, csrf, origin, method: "POST", body }))
      .status,
    201,
  );
  assert.equal(
    (
      await request("/v1/sessions", {
        cookie,
        csrf,
        origin,
        method: "POST",
        body,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/console/logout", {
        cookie,
        csrf,
        origin,
        method: "POST",
        body: {},
      })
    ).status,
    200,
  );
  assert.equal((await request("/v1/cases", { cookie })).status, 401);
});
test("context and case reads stay bounded and workspace-bound", async (t) => {
  const { request, store, cookie } = await fixture(t);
  const make = (id) => ({
    source: { adapter: "fixture", eventId: id },
    kind: "chat",
    text: id,
  });
  const own = store.append("alpha", "session", [make("own")])[0].evidence;
  const other = store.append("beta", "session", [make("other")])[0].evidence;
  store.createCase(
    "beta",
    { id: "private-case", title: "Private", question: "Private?" },
    "beta",
  );
  assert.equal(
    (await request(`/v1/evidence/${other.id}/context`, { cookie })).status,
    404,
  );
  assert.equal(
    (await request(`/v1/evidence/${own.id}/context?limit=201`, { cookie }))
      .status,
    400,
  );
  assert.equal(
    (await request(`/v1/evidence/${own.id}/context`, { cookie })).status,
    200,
  );
  assert.deepEqual(
    (await (await request("/v1/cases", { cookie })).json()).cases,
    [],
  );
  assert.equal(
    (await request("/v1/cases/private-case", { cookie })).status,
    404,
  );
  assert.equal((await request("/v1/cases?offset=-1", { cookie })).status, 400);
});
