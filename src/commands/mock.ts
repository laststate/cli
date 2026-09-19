import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import getPort from "get-port";
import { decodeLep } from "../lib/lep.js";
import { emitJson, isJson, log } from "../lib/logger.js";
import { header } from "../ui/banner.js";

export interface MockOpts {
  port?: string;
  host?: string;
  requireAuth?: boolean;
  token?: string;
  cors?: boolean;
  logIngest?: boolean;
}

function send(res: ServerResponse, code: number, obj: unknown, extraHeaders: Record<string, string> = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", ...extraHeaders });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export async function mock(rawOpts: MockOpts) {
  const host = rawOpts.host ?? "localhost";
  let port = parseInt(rawOpts.port ?? "8080", 10);
  if (Number.isNaN(port)) port = 8080;
  const requireAuth = !!rawOpts.requireAuth;
  const token = rawOpts.token ?? process.env.LASTSTATE_INGEST_TOKEN ?? "dev-mock-token";
  const seen = new Map<string, number>();

  try {
    port = await getPort({ port, host });
  } catch { /* keep requested */ }

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    const path = url.split("?")[0];
    if (rawOpts.cors !== false) res.setHeader("Access-Control-Allow-Origin", "*");

    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization" });
      res.end();
      return;
    }

    // health (Trace-compatible + legacy)
    if (path === "/health/live" || path === "/v1/health" || path === "/health") {
      send(res, 200, { status: "ok", mode: "mock" });
      return;
    }
    if (path === "/health/ready") {
      send(res, 200, { status: "ready", mode: "mock", checks: { store: "ok", queue: "ok" } });
      return;
    }
    if (path === "/metrics") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`# HELP laststate_mock_ingest_total\nlaststate_mock_ingest_total ${seen.size}\n`);
      return;
    }
    if (path === "/v1/ingest/capabilities" || path === "/v1/relay/capabilities" || path === "/v1/capabilities") {
      send(res, 200, {
        api_version: "1",
        lep_versions: [1, 2],
        max_event_size: 4194304,
        max_batch_events: 100,
        max_batch_bytes: 67108864,
        compression: ["identity", "zstd"],
        batch_ingest: true,
        binary_batch: true,
        artifact_upload: false,
        auth: requireAuth ? ["bearer"] : ["none", "bearer"],
      });
      return;
    }

    if ((path === "/v1/ingest" || path === "/v1/events") && req.method === "POST") {
      if (requireAuth) {
        const auth = req.headers.authorization ?? "";
        if (auth !== `Bearer ${token}`) {
          send(res, 401, { error: "unauthorized", hint: "set Authorization: Bearer <token> or restart without --require-auth" });
          return;
        }
      }
      const body = await readBody(req);
      const id = `mock-${randomBytes(4).toString("hex")}`;
      const d = decodeLep(new Uint8Array(body));
      const eventId = d.eventId !== null ? String(d.eventId) : id;
      const duplicate = seen.has(eventId);
      seen.set(eventId, Date.now());
      if (rawOpts.logIngest !== false && !isJson()) {
        log.info(`[ingest] ${body.length} bytes ${d.ok ? `LEP v${d.version} ${d.eventName}` : "(opaque)"} -> ${duplicate ? "duplicate" : "stored"}`);
      }
      if (path === "/v1/ingest") {
        // Relay semantics: 201 created / 200 duplicate
        send(res, duplicate ? 200 : 201, { id: eventId, duplicate }, { "X-Last-State-Event-ID": eventId });
      } else {
        // Trace semantics: always 202
        send(res, 202, { id: eventId, status: duplicate ? "duplicate" : "accepted" }, { "X-Last-State-Event-ID": eventId });
      }
      return;
    }

    if (path === "/v1/events:batch" && req.method === "POST") {
      const body = await readBody(req);
      send(res, 202, { accepted: 1, duplicates: 0, rejected: [], bytes: body.length });
      return;
    }

    if (path === "/v1/artifacts" && req.method === "POST") {
      send(res, 200, { ok: true, mode: "mock", note: "artifact upload stubbed — use real Trace for symbolication" });
      return;
    }

    send(res, 200, { mock: true, path, time: new Date().toISOString() });
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));

  const result = {
    ok: true,
    url: `http://${host}:${port}`,
    routes: ["POST /v1/ingest -> 201/200", "POST /v1/events -> 202", "GET /v1/relay/capabilities", "GET /health/live|ready", "GET /metrics"],
    auth: requireAuth ? "bearer required" : "open",
  };
  if (isJson()) {
    emitJson(result);
  } else {
    header("LastState mock Trace");
    log.ok(`Mock listening on http://${host}:${port}`);
    for (const r of result.routes) log.dim(r);
    log.info(`Auth: ${result.auth}`);
    console.log("  Press Ctrl+C to stop\n");
  }
  await new Promise(() => {});
}
