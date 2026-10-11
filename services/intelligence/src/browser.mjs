import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createReadStream, statSync, realpathSync } from "node:fs";
import { resolve, sep, extname } from "node:path";
import { Fault, ident, object, text } from "./validation.mjs";

// Private operator transport with optional persisted, workspace-bound accounts.
export function browserTransport({ origin, users, bundleDir, accounts: directory }, scopes) {
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    (url.protocol !== "https:" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  )
    throw new Fault("invalid_console_origin");
  if (!directory && (!Array.isArray(users) || !users.length || users.length > 100))
    throw new Fault("browser_users_required");
  const names = new Set();
  const accounts = (directory ? [] : users).map((user) => {
    object(user, ["username", "password", "workspace", "scopes"]);
    ident(user.username);
    ident(user.workspace);
    text(user.password, 256);
    if (
      user.password.length < 12 ||
      names.has(user.username) ||
      !Array.isArray(user.scopes) ||
      !user.scopes.length ||
      user.scopes.some((s) => !scopes.includes(s))
    )
      throw new Fault("invalid_browser_user");
    names.add(user.username);
    const salt = randomBytes(16);
    return {
      username: user.username,
      salt,
      hash: scryptSync(user.password, salt, 64),
      principal: {
        workspace: user.workspace,
        subject: user.username,
        scopes: new Set(user.scopes),
      },
    };
  });
  const sessions = new Map(),
    failures = new Map();
  const secure = url.protocol === "https:";
  const cookie = (value, maxAge) =>
    `livelens_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  const session = (request) => {
    if (request.headers.host !== url.host)
      throw new Fault("console_host_denied", 403);
    if (request.headers.origin && request.headers.origin !== origin)
      throw new Fault("console_origin_denied", 403);
    if (request.headers["sec-fetch-site"] === "cross-site")
      throw new Fault("console_origin_denied", 403);
    const id = /(?:^|;\s*)livelens_session=([A-Za-z0-9_-]+)/.exec(
      request.headers.cookie ?? "",
    )?.[1];
    const value = sessions.get(id);
    if (!value || value.expires < Date.now()) {
      sessions.delete(id);
      throw new Fault("unauthorised", 401);
    }
    if (directory) value.principal = directory.refresh(value.principal, value.credentialVersion);
    if (
      !["GET", "HEAD"].includes(request.method) &&
      (request.headers.origin !== origin ||
        request.headers["x-livelens-csrf"] !== value.csrf)
    )
      throw new Fault("csrf_denied", 403);
    return { ...value, id };
  };
  const originGuard = request => {
    if (request.headers.host !== url.host || request.headers.origin !== origin || request.headers['sec-fetch-site'] === 'cross-site') throw new Fault('console_origin_denied', 403);
  };
  const issueSession = (principal, response, send) => {
    for (const [key, value] of sessions) if (value.expires < Date.now()) sessions.delete(key);
    if (sessions.size >= 1000) throw new Fault('session_capacity', 429);
    if (directory) principal = directory.refresh(principal, principal.credentialVersion);
    const id = randomBytes(32).toString('base64url');
    const value = { principal, credentialVersion: principal.credentialVersion, csrf: randomBytes(32).toString('base64url'), expires: Date.now() + 8 * 60 * 60_000 };
    sessions.set(id, value); response.setHeader('Set-Cookie', cookie(id, 8 * 60 * 60));
    send(response, 200, { workspace: principal.workspace, subject: principal.subject, csrf: value.csrf });
  };
  return {
    authenticate(request) {
      return session(request).principal;
    },
    async route(request, response, pathname, readBody, send) {
      if (directory && ['/console/invitations/inspect', '/console/invitations/redeem'].includes(pathname) && request.method === 'POST') {
        originGuard(request);
        const body = object(await readBody(request), pathname.endsWith('/inspect') ? ['token'] : ['token', 'password']);
        if (pathname.endsWith('/inspect')) send(response, 200, directory.inspect(body.token, request.socket.remoteAddress));
        else issueSession(await directory.redeem(body, request.socket.remoteAddress), response, send);
        return true;
      }
      if (pathname === "/console/login" && request.method === "POST") {
        if (directory) {
          originGuard(request);
          const body = object(await readBody(request), ['username', 'password', 'workspace']);
          issueSession(await directory.login(body, request.socket.remoteAddress), response, send); return true;
        }
        if (
          request.headers.host !== url.host ||
          request.headers.origin !== origin
        )
          throw new Fault("console_origin_denied", 403);
        const address = request.socket.remoteAddress;
        for (const [key, value] of failures)
          if (value.until < Date.now()) failures.delete(key);
        const attempts = failures.get(address) ?? {
          n: 0,
          until: Date.now() + 60_000,
        };
        if (attempts.n >= 5) throw new Fault("login_rate_limited", 429);
        if (failures.size > 10_000) throw new Fault("login_rate_limited", 429);
        const body = object(await readBody(request), ["username", "password"]);
        text(body.username, 96);
        text(body.password, 256);
        const account = accounts.find((a) => a.username === body.username);
        const supplied = scryptSync(
          body.password,
          account?.salt ?? Buffer.alloc(16),
          64,
        );
        if (!account || !timingSafeEqual(supplied, account.hash)) {
          attempts.n++;
          failures.set(address, attempts);
          throw new Fault("unauthorised", 401);
        }
        failures.delete(address);
        for (const [key, value] of sessions)
          if (value.expires < Date.now()) sessions.delete(key);
        if (sessions.size >= 1000) throw new Fault("session_capacity", 429);
        issueSession(account.principal, response, send);
        return true;
      }
      if (pathname === "/console/session" && request.method === "GET") {
        const value = session(request);
        send(response, 200, {
          workspace: value.principal.workspace,
          subject: value.principal.subject,
          csrf: value.csrf,
        });
        return true;
      }
      if (pathname === "/console/logout" && request.method === "POST") {
        const value = session(request);
        sessions.delete(value.id);
        response.setHeader("Set-Cookie", cookie("", 0));
        send(response, 200, { ok: true });
        return true;
      }
      if (
        (pathname === "/" || pathname.startsWith("/app/")) &&
        request.method === "GET" &&
        bundleDir
      ) {
        if (request.headers.host !== url.host)
          throw new Fault("console_host_denied", 403);
        if (pathname === "/") {
          response.writeHead(302, { Location: "/app/" });
          response.end();
          return true;
        }
        const root = realpathSync(bundleDir);
        const relative =
          pathname === "/" || pathname === "/app/"
            ? "index.html"
            : decodeURIComponent(pathname.slice(5));
        let path;
        try {
          path = realpathSync(resolve(root, relative));
        } catch {
          throw new Fault("not_found", 404);
        }
        if (!path.startsWith(root + sep) || !statSync(path).isFile())
          throw new Fault("not_found", 404);
        const mime =
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".woff2": "font/woff2",
          }[extname(path)] ?? "application/octet-stream";
        response.writeHead(200, {
          "Content-Type": mime,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        });
        createReadStream(path)
          .on("error", () => response.destroy())
          .pipe(response);
        return true;
      }
      return false;
    },
  };
}
