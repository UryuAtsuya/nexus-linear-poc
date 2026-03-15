#!/usr/bin/env node
/**
 * cleanup-runs.mjs
 *
 * Remove run artifact directories older than a TTL from the runs base dir.
 *
 * Usage:
 *   node scripts/cleanup-runs.mjs [--dir /tmp/nexus-linear-poc-runs] [--ttl-hours 24] [--dry-run]
 */

import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_RUNS_DIR = "/tmp/nexus-linear-poc-runs";
const DEFAULT_TTL_HOURS = 24;

function parseArgs(argv) {
  const opts = {
    runsDir: DEFAULT_RUNS_DIR,
    ttlHours: DEFAULT_TTL_HOURS,
    dryRun: false
  };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") {
      opts.runsDir = argv[++i] ?? opts.runsDir;
    } else if (argv[i] === "--ttl-hours") {
      const v = Number(argv[++i]);
      if (!Number.isNaN(v) && v > 0) opts.ttlHours = v;
    } else if (argv[i] === "--dry-run") {
      opts.dryRun = true;
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cutoff = Date.now() - opts.ttlHours * 60 * 60 * 1000;

  let entries;
  try {
    entries = await readdir(opts.runsDir);
  } catch {
    console.log(`Runs directory not found: ${opts.runsDir}`);
    return;
  }

  let removed = 0;
  let skipped = 0;

  for (const entry of entries) {
    const fullPath = path.join(opts.runsDir, entry);
    let info;
    try {
      info = await stat(fullPath);
    } catch {
      continue;
    }

    if (!info.isDirectory()) continue;

    const ageMs = Date.now() - info.mtimeMs;
    if (info.mtimeMs > cutoff) {
      skipped++;
      continue;
    }

    const ageHours = (ageMs / 3600000).toFixed(1);
    if (opts.dryRun) {
      console.log(`[dry-run] would remove ${entry} (${ageHours}h old)`);
    } else {
      await rm(fullPath, { recursive: true, force: true });
      console.log(`removed ${entry} (${ageHours}h old)`);
    }
    removed++;
  }

  console.log(
    `done — removed ${removed}, skipped ${skipped} (ttl=${opts.ttlHours}h, dry-run=${opts.dryRun})`
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
