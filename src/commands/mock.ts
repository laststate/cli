import { createServer } from "node:http";

export async function mock(opts: { port?: string; host?: string }) {
  const port = parseInt(opts.port ?? "8080", 10);
  const host = opts.host ?? "localhost";
  console.log(`\n  Starting LastState mock Trace on http://${host}:${port}\n`);

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (url.startsWith("/v1/ingest") && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(202);
        res.end(JSON.stringify({ status: "stored", id: `mock-${Date.now()}` }));
        console.log(`  [ingest] ${body.length} bytes -> stored`);
      });
      return;
    }
    if (url === "/v1/health" || url === "/health") {
      res.writeHead(200);
      res.end(JSON.stringify({ status: "ok", mode: "mock" }));
      return;
    }
    if (url === "/v1/capabilities" || url === "/v1/ingest/capabilities") {
      res.writeHead(200);
      res.end(JSON.stringify({ lep_versions: [1, 2], max_envelope: 65535 }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify({ mock: true, path: url, time: new Date().toISOString() }));
  });

  server.listen(port, host, () => {
    console.log(`  Mock listening on http://${host}:${port}`);
    console.log("  POST /v1/ingest  -> 202 {status:stored}");
    console.log("  Press Ctrl+C to stop\n");
  });

  // keep alive
  await new Promise(() => {});
}
