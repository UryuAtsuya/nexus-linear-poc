import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";

import { runPrototype } from "../../orchestrator/src/index.js";

const PORT = process.env.PORT ?? 3000;
const WEBHOOK_SECRET = process.env.LINEAR_WEBHOOK_SECRET ?? "";
const AI_READY_LABEL = process.env.AI_READY_LABEL ?? "ai-ready";

// ── signature ──────────────────────────────────────────────────────────────

function verifySignature(rawBody, header) {
  if (!WEBHOOK_SECRET) return true; // skip when secret not configured (dev)
  const expected = createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  try {
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  } catch {
    return false; // length mismatch → reject
  }
}

// ── payload helpers ────────────────────────────────────────────────────────

function hasLabel(issueData, name) {
  return (issueData?.labels ?? []).some(
    (l) => l.name?.toLowerCase() === name.toLowerCase()
  );
}

function buildRunOptions(issueId) {
  return {
    issueId,
    linearMode: "api",
    claudeMode: process.env.CLAUDE_MODE ?? "stub",
    githubMode: process.env.GITHUB_MODE ?? "draft-only",
    githubTarget: process.env.GITHUB_TARGET ?? "pr-draft",
    workspaceMode: process.env.WORKSPACE_MODE ?? "scaffold",
    notifyLinear: process.env.NOTIFY_LINEAR !== "false",
  };
}

// ── request handler ────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  // health check
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

  // read body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");

  // verify signature
  const sig = req.headers["linear-signature"] ?? "";
  if (!verifySignature(rawBody, sig)) {
    console.warn("[webhook] invalid signature — rejected");
    res.writeHead(401);
    res.end("invalid signature");
    return;
  }

  // parse JSON
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    res.writeHead(400);
    res.end("invalid json");
    return;
  }

  // acknowledge immediately — Linear expects a fast 200
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("accepted");

  // only react to Issue events that carry the ai-ready label
  if (payload.type !== "Issue") return;
  if (!hasLabel(payload.data, AI_READY_LABEL)) return;

  const issueId = payload.data?.identifier;
  if (!issueId) {
    console.warn("[webhook] Issue event missing identifier, skipping");
    return;
  }

  console.log(
    `[webhook] ${payload.action} ${issueId} has label "${AI_READY_LABEL}" — starting orchestrator`
  );

  runPrototype(buildRunOptions(issueId))
    .then((result) => {
      console.log(`[webhook] ${issueId} finished: ${result.status}`);
    })
    .catch((err) => {
      console.error(`[webhook] ${issueId} error: ${err.message}`);
    });
}

// ── server ─────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error("[webhook] unhandled error:", err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("internal error");
    }
  });
});

server.listen(PORT, () => {
  console.log(`[webhook-gateway] listening on :${PORT}`);
  console.log(`  POST /webhook/linear`);
  console.log(`  GET  /health`);
  console.log(`  AI_READY_LABEL = "${AI_READY_LABEL}"`);
  console.log(`  CLAUDE_MODE    = "${process.env.CLAUDE_MODE ?? "stub"}"`);
  console.log(`  GITHUB_MODE    = "${process.env.GITHUB_MODE ?? "draft-only"}"`);
  console.log(`  NOTIFY_LINEAR  = "${process.env.NOTIFY_LINEAR ?? "true"}"`);
});

export { server };
