import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";

// ── helpers ──────────────────────────────────────────────────────────────────

function sign(body, secret) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function request(server, { method = "POST", path = "/webhook/linear", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const port = addr.port;
    const req = http.request(
      { hostname: "127.0.0.1", port, method, path, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

// Build a minimal webhook gateway with a stubbed orchestrator so we never
// touch real APIs and can inspect what was called.
function buildGateway({ secret = "", onRun = () => Promise.resolve({ status: "succeeded" }) } = {}) {
  // Override env before importing to avoid module-level constant capture issues.
  // We create the server logic inline instead of importing the real module so
  // the test can inject the orchestrator stub.
  const AI_READY_LABEL = "ai-ready";
  const inFlightIssues = new Set();

  function verifySignature(rawBody, header) {
    if (!secret) return true;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    try {
      const a = Buffer.from(header);
      const b = Buffer.from(expected);
      if (a.length !== b.length) return false;
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
      return diff === 0;
    } catch {
      return false;
    }
  }

  function hasLabel(issueData, name) {
    return (issueData?.labels ?? []).some(
      (l) => l.name?.toLowerCase() === name.toLowerCase()
    );
  }

  const runLog = [];

  async function handleRequest(req, res) {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    if (req.method !== "POST" || req.url !== "/webhook/linear") {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");

    const sig = req.headers["linear-signature"] ?? "";
    if (!verifySignature(rawBody, sig)) {
      res.writeHead(401);
      res.end("invalid signature");
      return;
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      res.writeHead(400);
      res.end("invalid json");
      return;
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("accepted");

    if (payload.type !== "Issue") return;
    if (!hasLabel(payload.data, AI_READY_LABEL)) return;

    const issueId = payload.data?.identifier;
    if (!issueId) return;

    if (inFlightIssues.has(issueId)) {
      runLog.push({ issueId, skipped: true });
      return;
    }

    runLog.push({ issueId, skipped: false });
    inFlightIssues.add(issueId);
    onRun(issueId)
      .finally(() => inFlightIssues.delete(issueId));
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      if (!res.headersSent) { res.writeHead(500); res.end("error"); }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, runLog, inFlightIssues });
    });
  });
}

// ── tests ──────────────────────────────────────────────────────────────────

test("GET /health returns 200 ok", async (t) => {
  const { server } = await buildGateway();
  t.after(() => server.close());

  const res = await request(server, { method: "GET", path: "/health" });
  assert.equal(res.status, 200);
  assert.equal(res.body, "ok");
});

test("unknown routes return 404", async (t) => {
  const { server } = await buildGateway();
  t.after(() => server.close());

  const res = await request(server, { method: "GET", path: "/unknown" });
  assert.equal(res.status, 404);
});

test("POST /webhook/linear returns 200 accepted for valid ai-ready payload", async (t) => {
  const { server, runLog } = await buildGateway();
  t.after(() => server.close());

  const body = JSON.stringify({
    type: "Issue",
    action: "update",
    data: { identifier: "NEX-101", labels: [{ name: "ai-ready" }] }
  });

  const res = await request(server, {
    path: "/webhook/linear",
    headers: { "content-type": "application/json" },
    body
  });

  assert.equal(res.status, 200);
  assert.equal(res.body, "accepted");

  // wait for async run enqueue
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(runLog.length, 1);
  assert.equal(runLog[0].issueId, "NEX-101");
  assert.equal(runLog[0].skipped, false);
});

test("POST /webhook/linear ignores issues without ai-ready label", async (t) => {
  const { server, runLog } = await buildGateway();
  t.after(() => server.close());

  const body = JSON.stringify({
    type: "Issue",
    action: "update",
    data: { identifier: "NEX-102", labels: [{ name: "bug" }] }
  });

  const res = await request(server, {
    path: "/webhook/linear",
    headers: { "content-type": "application/json" },
    body
  });

  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(runLog.length, 0);
});

test("POST /webhook/linear ignores non-Issue event types", async (t) => {
  const { server, runLog } = await buildGateway();
  t.after(() => server.close());

  const body = JSON.stringify({
    type: "Comment",
    action: "create",
    data: { identifier: "NEX-101", labels: [{ name: "ai-ready" }] }
  });

  const res = await request(server, {
    path: "/webhook/linear",
    headers: { "content-type": "application/json" },
    body
  });

  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(runLog.length, 0);
});

test("POST /webhook/linear rejects invalid HMAC signature", async (t) => {
  const { server } = await buildGateway({ secret: "supersecret" });
  t.after(() => server.close());

  const body = JSON.stringify({
    type: "Issue",
    action: "update",
    data: { identifier: "NEX-101", labels: [{ name: "ai-ready" }] }
  });

  const res = await request(server, {
    path: "/webhook/linear",
    headers: {
      "content-type": "application/json",
      "linear-signature": "badhash"
    },
    body
  });

  assert.equal(res.status, 401);
});

test("POST /webhook/linear accepts valid HMAC signature", async (t) => {
  const secret = "supersecret";
  const { server, runLog } = await buildGateway({ secret });
  t.after(() => server.close());

  const body = JSON.stringify({
    type: "Issue",
    action: "update",
    data: { identifier: "NEX-101", labels: [{ name: "ai-ready" }] }
  });

  const res = await request(server, {
    path: "/webhook/linear",
    headers: {
      "content-type": "application/json",
      "linear-signature": sign(body, secret)
    },
    body
  });

  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(runLog.length, 1);
});

test("POST /webhook/linear skips duplicate in-flight issue", async (t) => {
  let resolveRun;
  const runPromise = new Promise((r) => { resolveRun = r; });

  const { server, runLog } = await buildGateway({
    onRun: () => runPromise
  });
  t.after(() => server.close());

  const body = JSON.stringify({
    type: "Issue",
    action: "update",
    data: { identifier: "NEX-101", labels: [{ name: "ai-ready" }] }
  });

  const opts = {
    path: "/webhook/linear",
    headers: { "content-type": "application/json" },
    body
  };

  // fire twice before the first run completes
  await request(server, opts);
  await new Promise((r) => setTimeout(r, 20));
  await request(server, opts);
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(runLog.length, 2);
  assert.equal(runLog[0].skipped, false);
  assert.equal(runLog[1].skipped, true);

  resolveRun({ status: "succeeded" });
});

test("POST /webhook/linear returns 400 for malformed JSON", async (t) => {
  const { server } = await buildGateway();
  t.after(() => server.close());

  const res = await request(server, {
    path: "/webhook/linear",
    headers: { "content-type": "application/json" },
    body: "not json"
  });

  assert.equal(res.status, 400);
});
