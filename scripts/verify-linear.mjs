#!/usr/bin/env node
/**
 * verify-linear.mjs
 *
 * Linear API 接続確認スクリプト。
 * API キーが有効かどうか、および指定した issue が取得できるかを確認する。
 *
 * Usage:
 *   LINEAR_API_KEY=lin_api_xxx node scripts/verify-linear.mjs
 *   LINEAR_API_KEY=lin_api_xxx node scripts/verify-linear.mjs --issue-id NEX-101
 */

import { createLinearClient } from "../packages/linear-client/src/index.js";

const ENDPOINT = "https://api.linear.app/graphql";

function parseArgs(argv) {
  const args = { issueId: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--issue-id" && argv[i + 1]) {
      args.issueId = argv[++i];
    }
  }
  return args;
}

async function verifyViewer(apiKey) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: apiKey
    },
    body: JSON.stringify({ query: "{ viewer { id name email } }" })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from Linear API`);
  }

  const body = await response.json();

  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }

  return body.data.viewer;
}

async function main() {
  const { issueId } = parseArgs(process.argv);
  const apiKey = process.env.LINEAR_API_KEY;

  if (!apiKey) {
    console.error("ERROR: LINEAR_API_KEY environment variable is required.");
    process.exit(1);
  }

  // Step 1: API キー検証
  console.log("Verifying Linear API key...");
  let viewer;
  try {
    viewer = await verifyViewer(apiKey);
  } catch (err) {
    console.error(`ERROR: API key verification failed — ${err.message}`);
    process.exit(1);
  }
  console.log(`OK  Authenticated as: ${viewer.name} <${viewer.email}>`);

  // Step 2: issue 取得 (--issue-id 指定時のみ)
  if (!issueId) {
    console.log("\nTip: pass --issue-id <ID> to also verify issue fetching.");
    return;
  }

  console.log(`\nFetching issue "${issueId}"...`);
  const client = createLinearClient({ mode: "api", apiKey });
  let issue;
  try {
    issue = await client.getIssue(issueId);
  } catch (err) {
    console.error(`ERROR: Failed to fetch issue — ${err.message}`);
    process.exit(1);
  }

  console.log("OK  Issue fetched:");
  console.log(JSON.stringify(issue, null, 2));
}

main();
